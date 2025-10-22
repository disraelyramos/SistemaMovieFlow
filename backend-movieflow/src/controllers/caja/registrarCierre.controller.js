// backend-movieflow/src/controllers/registrarCierre.controller.js
const db = require("../../config/db");
const oracledb = require("oracledb");

/**
 * 🔹 Registrar cierre de caja
 * Valida que monto contado vs monto esperado.
 * Regla nueva: SOLO "Caja Taquilla" suma pagos de reservas de eventos.
 */
exports.registrarCierreCaja = async (req, res) => {
  let connection;
  const { usuario_id, apertura_id, denominaciones, observaciones } = req.body;

  try {
    if (!usuario_id || !apertura_id || !denominaciones || denominaciones.length === 0) {
      return res.status(400).json({ message: "Faltan datos obligatorios" });
    }

    connection = await db.getConnection();

    // 1️⃣ Traer datos de apertura (incluye monto_apertura y caja_id)
    const aperturaResult = await connection.execute(
      `SELECT a.total_efectivo_inicial, a.caja_id, c.nombre_caja
         FROM pos_apertura_caja a
         JOIN pos_cajas c ON c.id_caja = a.caja_id
        WHERE a.id_apertura = :apertura_id
          AND a.estado_id = 1`, // solo aperturas abiertas
      { apertura_id },
      { outFormat: oracledb.OUT_FORMAT_OBJECT }
    );

    if (aperturaResult.rows.length === 0) {
      return res.status(400).json({ message: "No se encontró apertura activa para cerrar" });
    }

    const montoApertura = Number(aperturaResult.rows[0].TOTAL_EFECTIVO_INICIAL || 0);
    const cajaId        = aperturaResult.rows[0].CAJA_ID;
    const nombreCaja    = String(aperturaResult.rows[0].NOMBRE_CAJA || "");
    const esTaquilla    = nombreCaja.trim().toUpperCase() === "CAJA TAQUILLA";

    // 2️⃣ Calcular total de ventas POS del día en esa caja (snacks/combos)
    const ventasResult = await connection.execute(
      `SELECT NVL(SUM(total),0) AS total_ventas
         FROM pos_ventas
        WHERE caja_id = :caja_id
          AND usuario_id = :usuario_id
          AND fecha BETWEEN TRUNC(SYSDATE) AND TRUNC(SYSDATE) + 0.99999`,
      { caja_id: cajaId, usuario_id },
      { outFormat: oracledb.OUT_FORMAT_OBJECT }
    );
    const total_ventas = Number(ventasResult.rows[0].TOTAL_VENTAS || 0);

    // 2.1️⃣ Total de pagos de reservas (solo si es CAJA TAQUILLA)
    let total_pagos_reservas = 0;
    if (esTaquilla) {
      const pagosResult = await connection.execute(
        `SELECT NVL(SUM(MONTO_GTQ), 0) AS total_pagos_reservas
           FROM pos_pago_evento
          WHERE apertura_id = :apertura_id`,
        { apertura_id },
        { outFormat: oracledb.OUT_FORMAT_OBJECT }
      );
      total_pagos_reservas = Number(pagosResult.rows[0].TOTAL_PAGOS_RESERVAS || 0);
    }

    // 2.2️⃣ Monto esperado:
    //     - En CAJA TAQUILLA: apertura + ventas POS (si hubiera) + pagos de reservas
    //     - Otras cajas:       apertura + ventas POS (SIN pagos de reservas)
    const monto_esperado = Number(montoApertura + total_ventas + total_pagos_reservas);

    // 3️⃣ Insertar registro de cierre_caja (mantiene monto_ventas = ventas POS)
    const cierreResult = await connection.execute(
      `INSERT INTO pos_cierre_caja
         (apertura_id, usuario_id, monto_apertura, monto_ventas, monto_esperado, observaciones, estado_id, fecha_cierre, hora_cierre)
       VALUES
         (:apertura_id, :usuario_id, :monto_apertura, :monto_ventas, :monto_esperado, :observaciones, 1, TRUNC(SYSDATE), SYSTIMESTAMP)
       RETURNING id_cierre INTO :id_cierre`,
      {
        apertura_id,
        usuario_id,
        monto_apertura: montoApertura,
        monto_ventas: total_ventas,      // ventas POS (no tocamos reportes)
        monto_esperado,                  // incluye reservas SOLO si es Taquilla
        observaciones: observaciones || null,
        id_cierre: { dir: oracledb.BIND_OUT, type: oracledb.NUMBER }
      },
      { autoCommit: false }
    );

    const id_cierre = cierreResult.outBinds.id_cierre[0];

    // 4️⃣ Insertar denominaciones del cierre
    for (const d of denominaciones) {
      if (!d || d.cantidad == null || d.cantidad < 0) {
        await connection.rollback();
        return res.status(400).json({ message: "Denominación con cantidad inválida" });
      }

      // Traemos el valor para calcular subtotal (aunque tu trigger también lo maneje)
      const valRes = await connection.execute(
        `SELECT valor FROM pos_denominaciones WHERE id_denominacion = :id`,
        { id: d.denominacion_id },
        { outFormat: oracledb.OUT_FORMAT_OBJECT }
      );
      if (valRes.rows.length === 0) {
        await connection.rollback();
        return res.status(400).json({ message: `Denominación inválida: ${d.denominacion_id}` });
      }
      const valor = Number(valRes.rows[0].VALOR);
      const subtotal = Number(d.cantidad) * valor;

      await connection.execute(
        `INSERT INTO pos_cierre_denominacion
           (cierre_id, denominacion_id, cantidad, subtotal)
         VALUES
           (:cierre_id, :denominacion_id, :cantidad, :subtotal)`,
        {
          cierre_id: id_cierre,
          denominacion_id: d.denominacion_id,
          cantidad: d.cantidad,
          subtotal
        },
        { autoCommit: false }
      );
    }

    // 5️⃣ Consultar monto_contado (calculado por trigger/insert detalle)
    const contadoResult = await connection.execute(
      `SELECT monto_contado
         FROM pos_cierre_caja
        WHERE id_cierre = :id_cierre`,
      { id_cierre },
      { outFormat: oracledb.OUT_FORMAT_OBJECT }
    );
    const monto_contado = Number(contadoResult.rows[0].MONTO_CONTADO || 0);

    // 6️⃣ Validaciones contra monto esperado
    if (monto_contado < monto_esperado) {
      await connection.rollback();
      return res.status(400).json({
        message: `❌ No cuadra el cierre. Faltan Q${(monto_esperado - monto_contado).toFixed(2)}`
      });
    }

    if (monto_contado > monto_esperado) {
      if (!observaciones || observaciones.trim() === "") {
        await connection.rollback();
        return res.status(400).json({
          message: `❌ El monto contado supera al esperado (Esperado: Q${monto_esperado.toFixed(2)}, Contado: Q${monto_contado.toFixed(2)}). Debe ingresar observaciones para continuar.`
        });
      }

      // Guardar diferencia
      await connection.execute(
        `UPDATE pos_cierre_caja
            SET diferencia = :diferencia
          WHERE id_cierre = :id_cierre`,
        {
          diferencia: Number((monto_contado - monto_esperado).toFixed(2)),
          id_cierre
        },
        { autoCommit: false }
      );
    }

    // 7️⃣ Marcar apertura como cerrada
    await connection.execute(
      `UPDATE pos_apertura_caja
          SET estado_id = 2
        WHERE id_apertura = :apertura_id`,
      { apertura_id },
      { autoCommit: false }
    );

    // 8️⃣ Marcar cierre como confirmado
    await connection.execute(
      `UPDATE pos_cierre_caja
          SET estado_id = 2
        WHERE id_cierre = :id_cierre`,
      { id_cierre },
      { autoCommit: false }
    );

    await connection.commit();

    // 🔎 Respuesta (incluye totales informativos)
    res.json({
      message: "✅ Caja cerrada correctamente",
      cierre_id: id_cierre,
      caja: nombreCaja,
      es_taquilla: esTaquilla,
      monto_contado,
      monto_esperado,
      total_pagos_reservas,  // informativo
      total_ventas           // informativo
    });
  } catch (error) {
    if (connection) await connection.rollback();
    console.error("❌ Error al cerrar caja:", error);
    res.status(500).json({ message: "Error interno del servidor" });
  } finally {
    if (connection) await connection.close();
  }
};
