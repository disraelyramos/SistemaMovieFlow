// src/controllers/empleado.controller.js
const oracledb = require('oracledb');
const db = require('../config/db');
const crypto = require('crypto'); // <- usado para QR y claves
const OUT_OBJ = { outFormat: oracledb.OUT_FORMAT_OBJECT };

// 🔸 TAQUILLA: helpers
async function getTaquillaOpenInfo(cn) {
  // Devuelve { cajaId, aperturaId, usuarioId } si hay Caja Taquilla abierta; si no, null
  const q = await cn.execute(
    `
    SELECT c.ID_CAJA AS "cajaId",
           a.ID_APERTURA AS "aperturaId",
           a.USUARIO_ID AS "usuarioId"
      FROM POS_APERTURA_CAJA a
      JOIN POS_CAJAS c ON c.ID_CAJA = a.CAJA_ID
     WHERE UPPER(TRIM(c.NOMBRE_CAJA)) = 'CAJA TAQUILLA'
       AND a.ESTADO_ID = 26
     ORDER BY a.FECHA_APERTURA DESC, a.HORA_APERTURA DESC
     FETCH FIRST 1 ROWS ONLY
    `,
    {},
    OUT_OBJ
  );
  if (!q.rows?.length) return null;
  return {
    cajaId: Number(q.rows[0].cajaId),
    aperturaId: Number(q.rows[0].aperturaId),
    usuarioId: Number(q.rows[0].usuarioId),
  };
}

async function insertVentaTaquilla(cn, { usuarioId, cajaId, total }) {
  // Inserta en POS_VENTAS con CODIGO_TICKET vía SEQ_TICKET_VENTAS
  const seq = await cn.execute(
    `SELECT LPAD(TO_CHAR(SEQ_TICKET_VENTAS.NEXTVAL), 6, '0') AS "ticket" FROM DUAL`,
    [],
    OUT_OBJ
  );
  const codigo_ticket = seq.rows[0].ticket;

  await cn.execute(
    `
    INSERT INTO POS_VENTAS
      (USUARIO_ID, CAJA_ID, DINERO_RECIBIDO, CAMBIO, TOTAL, ESTADO_ID, CODIGO_TICKET, FECHA_CREACION)
    VALUES
      (:usuario_id, :caja_id, :dinero_recibido, :cambio, :total, 26, :codigo_ticket, SYSTIMESTAMP)
    `,
    {
      usuario_id: Number(usuarioId),
      caja_id: Number(cajaId),
      dinero_recibido: Number(total), // en taquilla: pagado exacto
      cambio: 0,
      total: Number(total),
      codigo_ticket,
    },
    { outFormat: oracledb.OUT_FORMAT_OBJECT }
  );
  return codigo_ticket;
}

// Precio unitario de la función
async function getFuncionPrecio(cn, funcionId) {
  const r = await cn.execute(
    `SELECT PRECIO AS "precio" FROM FUNCIONES WHERE ID_FUNCION = :id`,
    { id: Number(funcionId) },
    OUT_OBJ
  );
  return r.rows?.[0]?.precio ? Number(r.rows[0].precio) : 0;
}

// Crea un "cliente de mostrador" mínimo para ventas en taquilla
async function ensureWalkinClient(cn, datos = {}) {
  const prov = 'taquilla';
  const sub = `walkin:${crypto.randomUUID()}`;
  const r = await cn.execute(
    `INSERT INTO CLIENTES(
       PROVIDER, PROVIDER_SUB, EMAIL, NOMBRE, FECHA_CREACION, ULTIMO_INGRESO
     ) VALUES (
       :prov, :sub, :email, :nombre, SYSTIMESTAMP, SYSTIMESTAMP
     ) RETURNING ID_CLIENTE INTO :id`,
    {
      prov,
      sub,
      email: datos.email || null,
      nombre: datos.nombre || 'Mostrador',
      id: { dir: oracledb.BIND_OUT, type: oracledb.NUMBER },
    },
    { autoCommit: false }
  );
  return Number(r.outBinds.id[0]);
}

// Genera placeholders :id0,:id1,...
function bindList(prefix, arr, target) {
  return arr.map((v, i) => {
    target[`${prefix}${i}`] = Number(v);
    return `:${prefix}${i}`;
  });
}

/* ===================== CARTELERA ===================== */
exports.getCartelera = async (req, res) => {
  let cn;
  try {
    cn = await db.getConnection();
    const sql = `
      SELECT
        p.ID_PELICULA                      AS id,
        p.TITULO                           AS titulo,
        p.DURACION_MINUTOS                 AS duracionMin,
        p.ESTADO                           AS estado,
        cat.NOMBRE                         AS categoriaNombre,
        idi.NOMBRE                         AS idioma,
        cla.NOMBRE                         AS clasificacion,
        CASE WHEN p.IMAGEN_URL IS NULL THEN NULL
             ELSE DBMS_LOB.SUBSTR(p.IMAGEN_URL, 4000, 1) END AS imagenUrl
      FROM PELICULA p
      LEFT JOIN CATEGORIAS     cat ON cat.ID_CATEGORIA     = p.ID_CATEGORIA
      LEFT JOIN IDIOMAS        idi ON idi.ID_IDIOMA        = p.ID_IDIOMA
      LEFT JOIN CLASIFICACION  cla ON cla.ID_CLASIFICACION = p.ID_CLASIFICACION
      WHERE p.ESTADO = 'ACTIVA'
      ORDER BY p.TITULO ASC
    `;
    const r = await cn.execute(sql, {}, OUT_OBJ);

    // NORMALIZACIÓN DE ALIAS
    const rows = (r.rows || []).map((R) => ({
      id: R.id ?? R.ID,
      titulo: R.titulo ?? R.TITULO,
      duracionMin: R.duracionMin ?? R.DURACIONMIN,
      estado: R.estado ?? R.ESTADO,
      categoriaNombre: R.categoriaNombre ?? R.CATEGORIANOMBRE,
      idioma: R.idioma ?? R.IDIOMA,
      clasificacion: R.clasificacion ?? R.CLASIFICACION,
      imagenUrl: String(R.imagenUrl ?? R.IMAGENURL ?? '').replace(/\\/g, '/'),
    }));

    res.json(rows);
  } catch (e) {
    console.error('GET /api/empleado/cartelera ->', e);
    res.status(500).json({ message: 'Error al obtener cartelera' });
  } finally {
    try { if (cn) await cn.close(); } catch {}
  }
};

/* ===================== FUNCIONES ===================== */
exports.getFuncionesByPelicula = async (req, res) => {
  let cn;
  try {
    const { peliculaId } = req.params;
    const { fecha } = req.query;
    cn = await db.getConnection();

    const where = [`f.ESTADO = 'ACTIVA'`, `f.ID_PELICULA = :peliculaId`];
    const bind = { peliculaId: Number(peliculaId) };
    if ((fecha || '').trim()) {
      where.push(`f.FECHA = TO_DATE(:fecha,'YYYY-MM-DD')`);
      bind.fecha = fecha.trim();
    }

    const sql = `
      SELECT
        f.ID_FUNCION AS "id",
        f.ID_PELICULA AS "peliculaId",
        f.ID_SALA     AS "salaId",
        TO_CHAR(f.FECHA,'YYYY-MM-DD') AS "fecha",
        TO_CHAR(f.FECHA + f.HORA_INICIO,'HH24:MI') AS "horaInicio",
        TO_CHAR(
          f.FECHA + f.HORA_FINAL
          + CASE WHEN f.HORA_FINAL <= f.HORA_INICIO
                 THEN NUMTODSINTERVAL(1,'DAY')
                 ELSE NUMTODSINTERVAL(0,'DAY') END,
          'HH24:MI'
        ) AS "horaFinal",
        f.PRECIO   AS "precio",
        s.NOMBRE   AS "salaNombre",
        frm.NOMBRE AS "formato",
        /* ---- contadores para SOLD OUT ---- */
        (SELECT COUNT(*) FROM FUNCION_ASIENTO fa
          WHERE fa.ID_FUNCION = f.ID_FUNCION) AS "totalSeats",
        (SELECT COUNT(*) FROM FUNCION_ASIENTO fa
          WHERE fa.ID_FUNCION = f.ID_FUNCION AND fa.ESTADO = 'VENDIDO') AS "vendidos",
        (SELECT COUNT(*) FROM FUNCION_ASIENTO fa
          WHERE fa.ID_FUNCION = f.ID_FUNCION AND fa.ESTADO = 'RESERVADO') AS "reservados",
        (SELECT COUNT(*) FROM FUNCION_ASIENTO fa
          WHERE fa.ID_FUNCION = f.ID_FUNCION
            AND (fa.ESTADO='DISPONIBLE'
                 OR (fa.ESTADO='BLOQUEADO' AND (fa.BLOQUEADO_HASTA IS NULL OR fa.BLOQUEADO_HASTA <= SYSTIMESTAMP))
            )
        ) AS "disponibles"
      FROM FUNCIONES f
      JOIN SALAS s      ON s.ID_SALA = f.ID_SALA
      LEFT JOIN FORMATO frm ON frm.ID_FORMATO = f.ID_FORMATO
      WHERE ${where.join(' AND ')}
      ORDER BY f.FECHA, f.ID_SALA, f.HORA_INICIO
    `;
    const r = await cn.execute(sql, bind, OUT_OBJ);
    res.json(r.rows || []);
  } catch (e) {
    console.error('GET /api/empleado/cartelera/:peliculaId/funciones ->', e);
    res.status(500).json({ message: 'Error al obtener funciones' });
  } finally {
    try { if (cn) await cn.close(); } catch {}
  }
};

/* ===================== ASIENTOS ===================== */
exports.getAsientosByFuncion = async (req, res) => {
  let cn;
  try {
    const { funcionId } = req.params;
    cn = await db.getConnection();

    const r = await cn.execute(
      `
      SELECT
        fa.ID_FA          AS "idFa",
        a.FILA            AS "fila",
        a.COLUMNA         AS "columna",
        a.TIPO            AS "tipo",
        fa.ESTADO         AS "estado",
        fa.BLOQUEADO_HASTA AS "bloqueado_hasta"
      FROM FUNCION_ASIENTO fa
      JOIN ASIENTOS a ON a.ID_ASIENTO = fa.ID_ASIENTO
      WHERE fa.ID_FUNCION = :id
      ORDER BY a.FILA, a.COLUMNA
      `,
      { id: Number(funcionId) },
      OUT_OBJ
    );

    res.json(r.rows || []);
  } catch (e) {
    console.error('GET /api/empleado/funciones/:funcionId/asientos ->', e);
    res.status(500).json({ message: 'Error al obtener asientos' });
  } finally {
    try { if (cn) await cn.close(); } catch {}
  }
};

/* ===================== VENDER ===================== */
exports.postVender = async (req, res) => {
  let cn;
  try {
    const { funcionId } = req.params;
    const { asientos = [], idemKey = null, cliente = null, metodoPago = null } = req.body;
    const metodo = String(metodoPago || 'EFECTIVO').toUpperCase();
    const MET = ['EFECTIVO','TARJETA','PAYPAL'].includes(metodo) ? metodo : 'EFECTIVO';

    if (!Array.isArray(asientos) || asientos.length === 0) {
      return res.status(400).json({ message: 'Debes enviar asientos[]' });
    }

    cn = await db.getConnection();
    // Comenzamos transacción explícita
    await cn.execute(`BEGIN NULL; END;`);

    // 🔸 TAQUILLA: exigir Caja Taquilla abierta ANTES de vender
    const taq = await getTaquillaOpenInfo(cn);
    if (!taq) {
      await cn.rollback();
      return res.status(409).json({ message: 'No se puede vender: Caja Taquilla no está abierta.' });
    }

    // 1) Identificar cuáles de los ID_FA vienen de una RESERVA
    const bind = { fun: Number(funcionId) };
    const inFa = bindList('fa', asientos, bind).join(','); // :fa0,:fa1,...
    const qRes = await cn.execute(
      `
      SELECT e.ID_FA     AS "idFa",
             e.ID_COMPRA AS "compraId"
        FROM ENTRADAS e
        JOIN COMPRAS  c ON c.ID_COMPRA = e.ID_COMPRA
       WHERE c.ID_FUNCION = :fun
         AND e.ID_FA IN (${inFa})
         AND e.ESTADO = 'RESERVADA'
      `,
      bind,
      OUT_OBJ
    );
    const reservadosRows = qRes.rows || [];
    const reservadosSet = new Set(reservadosRows.map(r => Number(r.idFa)));
    const aReservados = asientos.filter(x => reservadosSet.has(Number(x)));
    const aNuevos     = asientos.filter(x => !reservadosSet.has(Number(x)));

    // 2) CONFIRMAR RESERVAS -> ENTRADAS: RESERVADA -> EMITIDA (asigna QR)
    let confirmedFromRes = 0;
    if (aReservados.length > 0) {
      const b1 = { fun: Number(funcionId) };
      const in1 = bindList('r', aReservados, b1).join(',');
      // FUNCION_ASIENTO: RESERVADO -> VENDIDO
      const updFaRes = await cn.execute(
        `UPDATE FUNCION_ASIENTO
            SET ESTADO='VENDIDO', BLOQUEADO_HASTA=NULL
          WHERE ID_FUNCION=:fun
            AND ID_FA IN (${in1})
            AND ESTADO='RESERVADO'`,
        b1,
        { autoCommit: false }
      );
      confirmedFromRes = updFaRes.rowsAffected || 0;

      // ENTRADAS: RESERVADA -> EMITIDA (+ QR)
      for (const idFa of aReservados) {
        await cn.execute(
          `UPDATE ENTRADAS
              SET ESTADO='EMITIDA',
                  CODIGO_QR=:qr
            WHERE ID_FA=:fa
              AND ID_COMPRA IN (
                SELECT ID_COMPRA FROM COMPRAS WHERE ID_FUNCION=:fun
              )
              AND ESTADO='RESERVADA'`,
          { qr: crypto.randomUUID(), fa: Number(idFa), fun: Number(funcionId) },
          { autoCommit: false }
        );
      }

      // Para cada compra afectada, si TODAS sus entradas ya están EMITIDAS -> COMPRAS := PAGADA
      const comprasAfectadas = Array.from(new Set(reservadosRows.map(r => Number(r.compraId))));
      for (const cId of comprasAfectadas) {
        const rPend = await cn.execute(
          `SELECT COUNT(*) AS "pend"
             FROM ENTRADAS
            WHERE ID_COMPRA=:c
              AND ESTADO='RESERVADA'`,
          { c: cId },
          OUT_OBJ
        );
        const quedan = Number(rPend.rows?.[0]?.pend || 0);
        if (quedan === 0) {
          await cn.execute(
            `UPDATE COMPRAS
                SET ESTADO='PAGADA',
                    METODO_PAGO=:met
              WHERE ID_COMPRA=:c`,
            { c: cId, met: MET },
            { autoCommit: false }
          );
        }
      }
    }

    // 3) VENTA NUEVA EN TAQUILLA (DISPONIBLES) -> crear COMPRAS + ENTRADAS
    let vendidosNuevos = 0;
    let compraIdNueva = null;

    if (aNuevos.length > 0) {
      // (a) Marcar asientos como VENDIDO (solo si están disponibles o bloqueados vencidos)
      const b2 = { fun: Number(funcionId) };
      const in2 = bindList('n', aNuevos, b2).join(',');
      const updFaNew = await cn.execute(
        `UPDATE FUNCION_ASIENTO
            SET ESTADO='VENDIDO', BLOQUEADO_HASTA=NULL
          WHERE ID_FUNCION=:fun
            AND ID_FA IN (${in2})
            AND (
              ESTADO='DISPONIBLE'
              OR (ESTADO='BLOQUEADO' AND (BLOQUEADO_HASTA IS NULL OR BLOQUEADO_HASTA <= SYSTIMESTAMP))
            )`,
        b2,
        { autoCommit: false }
      );
      vendidosNuevos = updFaNew.rowsAffected || 0;
      if (vendidosNuevos < aNuevos.length) {
        await cn.rollback();
        return res.status(409).json({ message: 'Uno o más asientos ya no están disponibles.' });
      }

      // (b) Cliente de mostrador + COMPRAS + ENTRADAS (EMITIDA) + QR
      const precioUnit = await getFuncionPrecio(cn, funcionId);
      const total = precioUnit * aNuevos.length;

      const idCliente = await ensureWalkinClient(cn, cliente || {});
      const rComp = await cn.execute(
        `INSERT INTO COMPRAS(
           ID_CLIENTE, ID_FUNCION, MONTO_TOTAL, ESTADO, METODO_PAGO, IDEMPOTENCY_KEY
         ) VALUES (
           :cli, :fun, :tot, 'PAGADA', :met, :idem
         ) RETURNING ID_COMPRA INTO :id`,
        {
          cli: idCliente,
          fun: Number(funcionId),
          tot: total,
          met: MET,
          idem: idemKey || null,
          id: { dir: oracledb.BIND_OUT, type: oracledb.NUMBER },
        },
        { autoCommit: false }
      );
      compraIdNueva = Number(rComp.outBinds.id[0]);

      for (const idFa of aNuevos) {
        await cn.execute(
          `INSERT INTO ENTRADAS(
             ID_COMPRA, ID_FA, PRECIO, ESTADO, CODIGO_QR
           ) VALUES (
             :c, :fa, :p, 'EMITIDA', :qr
           )`,
          { c: compraIdNueva, fa: Number(idFa), p: precioUnit, qr: crypto.randomUUID() },
          { autoCommit: false }
        );
      }
    }

    // 🔸 TAQUILLA: registrar venta POS (boletos) por TODO lo emitido en esta operación
    const precioUnit = await getFuncionPrecio(cn, funcionId);
    const boletosCount = (aNuevos.length) + (confirmedFromRes);
    if (boletosCount > 0) {
      const totalBoletos = precioUnit * boletosCount;
      await insertVentaTaquilla(cn, {
        usuarioId: taq.usuarioId, // cajero que abrió caja taquilla
        cajaId: taq.cajaId,
        total: totalBoletos,
      });
    }

    await cn.commit();

    res.json({
      ok: true,
      funcionId: Number(funcionId),
      vendidosNuevos,
      confirmadosDesdeReserva: confirmedFromRes,
      compraIdNueva,
    });
  } catch (e) {
    try { if (cn) await cn.rollback(); } catch {}
    console.error('POST /api/empleado/funciones/:funcionId/vender ->', e);
    res.status(500).json({ message: e?.message || 'Error al procesar la venta' });
  } finally {
    try { if (cn) await cn.close(); } catch {}
  }
};

// src/controllers/empleado.controller.js
exports.postLiberarReservasVencidas = async (req, res) => {
  let cn;
  try {
    const funcionId = Number(req.params.funcionId);
    cn = await db.getConnection();

    // 1) RESERVA_ASIENTO: PENDIENTE -> CANCELADA para los FA vencidos de esta función
    const updRA = await cn.execute(
      `
      UPDATE RESERVA_ASIENTO ra
         SET ra.ESTADO = 'CANCELADA'
       WHERE ra.ESTADO = 'PENDIENTE'
         AND ra.ID_FA IN (
           SELECT fa.ID_FA
             FROM FUNCION_ASIENTO fa
            WHERE fa.ID_FUNCION = :funcionId
              AND fa.ESTADO = 'RESERVADO'
              AND fa.BLOQUEADO_HASTA IS NOT NULL
              AND fa.BLOQUEADO_HASTA <= SYSTIMESTAMP
         )
      `,
      { funcionId },
      { autoCommit: false }
    );

    // 2) ENTRADAS: RESERVADA -> CANCELADA para esos FA
    const updEnt = await cn.execute(
      `
      UPDATE ENTRADAS e
         SET e.ESTADO = 'CANCELADA'
       WHERE e.ESTADO = 'RESERVADA'
         AND e.ID_COMPRA IN (SELECT c.ID_COMPRA FROM COMPRAS c WHERE c.ID_FUNCION = :funcionId)
         AND e.ID_FA IN (
           SELECT fa.ID_FA
             FROM FUNCION_ASIENTO fa
            WHERE fa.ID_FUNCION = :funcionId
              AND fa.ESTADO = 'RESERVADO'
              AND fa.BLOQUEADO_HASTA IS NOT NULL
              AND fa.BLOQUEADO_HASTA <= SYSTIMESTAMP
         )
      `,
      { funcionId },
      { autoCommit: false }
    );

    // 3) LIBERAR los asientos
    const updFA = await cn.execute(
      `
      UPDATE FUNCION_ASIENTO
         SET ESTADO = 'DISPONIBLE',
             BLOQUEADO_HASTA = NULL
       WHERE ID_FUNCION = :funcionId
         AND ESTADO = 'RESERVADO'
         AND BLOQUEADO_HASTA IS NOT NULL
         AND BLOQUEADO_HASTA <= SYSTIMESTAMP
      `,
      { funcionId },
      { autoCommit: false }
    );

    // 4) COMPRAS: cancelar las que ya no tengan entradas RESERVADA ni EMITIDA
    const updCompras = await cn.execute(
      `
      UPDATE COMPRAS c
         SET c.ESTADO = 'CANCELADA'
       WHERE c.ID_FUNCION = :funcionId
         AND NOT EXISTS (
           SELECT 1
             FROM ENTRADAS e
            WHERE e.ID_COMPRA = c.ID_COMPRA
              AND e.ESTADO IN ('RESERVADA','EMITIDA')
         )
      `,
      { funcionId },
      { autoCommit: false }
    );

    await cn.commit();
    res.json({
      ok: true,
      released: updFA.rowsAffected || 0,
      reservaAsientoCanceladas: updRA.rowsAffected || 0,
      entradasCanceladas: updEnt.rowsAffected || 0,
      comprasCanceladas: updCompras.rowsAffected || 0
    });
  } catch (e) {
    try { if (cn) await cn.rollback(); } catch {}
    console.error('POST /empleado/funciones/:funcionId/liberar-reservas-vencidas ->', e);
    res.status(500).json({ message: 'Error al liberar reservas vencidas' });
  } finally {
    try { if (cn) await cn.close(); } catch {}
  }
};

// GET /empleado/funciones/:funcionId/reservas
exports.getReservasByFuncion = async (req, res) => {
  let cn;
  try {
    const { funcionId } = req.params;
    cn = await db.getConnection();
    const sql = `
      SELECT
        ra.NUMERO_RESERVA AS "numeroReserva",
        COUNT(*)          AS "cantidadAsientos",
        MIN(ra.CREADO_EN) AS "creadoEn",
        LISTAGG(a.FILA || a.COLUMNA, ',') WITHIN GROUP (ORDER BY a.FILA, a.COLUMNA) AS "asientos"
      FROM RESERVA_ASIENTO ra
      JOIN FUNCION_ASIENTO fa ON fa.ID_FA = ra.ID_FA
      JOIN ASIENTOS a         ON a.ID_ASIENTO = fa.ID_ASIENTO
      WHERE fa.ID_FUNCION = :fun
        AND ra.ESTADO = 'PENDIENTE'
        AND fa.ESTADO = 'RESERVADO'
        AND (fa.BLOQUEADO_HASTA IS NULL OR fa.BLOQUEADO_HASTA > SYSTIMESTAMP)
      GROUP BY ra.NUMERO_RESERVA
      ORDER BY MIN(ra.CREADO_EN) DESC`;
    const r = await cn.execute(sql, { fun: Number(funcionId) }, OUT_OBJ);
    res.json(r.rows || []);
  } catch (e) {
    console.error('GET /empleado/funciones/:funcionId/reservas ->', e);
    res.status(500).json({ message: 'Error al listar reservas' });
  } finally {
    try { if (cn) await cn.close(); } catch {}
  }
};

exports.postConfirmarReservaPorNumero = async (req, res) => {
  let cn;
  try {
    const { funcionId } = req.params;
    const { numeroReserva, metodoPago = 'EFECTIVO' } = req.body;

    if (!numeroReserva) return res.status(400).json({ message: 'Falta numeroReserva' });
    const MET = ['EFECTIVO','TARJETA','PAYPAL'].includes(String(metodoPago).toUpperCase())
      ? String(metodoPago).toUpperCase() : 'EFECTIVO';

    cn = await db.getConnection();
    await cn.execute(`BEGIN NULL; END;`);

    // 🔸 TAQUILLA: exigir Caja Taquilla abierta
    const taq = await getTaquillaOpenInfo(cn);
    if (!taq) {
      await cn.rollback();
      return res.status(409).json({ message: 'No se puede confirmar: Caja Taquilla no está abierta.' });
    }

    // 1) Recuperar todos los ID_FA de esa reserva
    const rFa = await cn.execute(
      `SELECT fa.ID_FA AS "idFa"
         FROM RESERVA_ASIENTO ra
         JOIN FUNCION_ASIENTO fa ON fa.ID_FA = ra.ID_FA
        WHERE fa.ID_FUNCION = :fun AND ra.NUMERO_RESERVA = :num`,
      { fun: Number(funcionId), num: Number(numeroReserva) },
      OUT_OBJ
    );
    const ids = (rFa.rows || []).map(r => Number(r.idFa));
    if (ids.length === 0) {
      await cn.rollback();
      return res.status(404).json({ message: 'No hay asientos para ese número de reserva' });
    }

    // 2) Marcar FUNCION_ASIENTO -> VENDIDO (debe estar RESERVADO)
    const bindUpd = { fun: Number(funcionId) };
    const inKeys  = ids.map((v, i) => ((bindUpd[`id${i}`] = v), `:id${i}`));
    const updFa = await cn.execute(
      `UPDATE FUNCION_ASIENTO
          SET ESTADO = 'VENDIDO', BLOQUEADO_HASTA = NULL
        WHERE ID_FUNCION = :fun AND ID_FA IN (${inKeys.join(',')}) AND ESTADO = 'RESERVADO'`,
      bindUpd,
      { autoCommit: false }
    );

    if ((updFa.rowsAffected || 0) < ids.length) {
      await cn.rollback();
      return res.status(409).json({ message: 'Algún asiento ya no está en estado RESERVADO.' });
    }

    // 3) ENTRADAS: RESERVADA -> EMITIDA; COMPRAS: PENDIENTE -> PAGADA (si todas emitidas)
    const rCompras = await cn.execute(
      `SELECT DISTINCT e.ID_COMPRA AS "compraId"
         FROM ENTRADAS e
         JOIN COMPRAS  c ON c.ID_COMPRA = e.ID_COMPRA
         JOIN RESERVA_ASIENTO ra ON ra.ID_FA = e.ID_FA
         JOIN FUNCION_ASIENTO fa ON fa.ID_FA = e.ID_FA
        WHERE c.ID_FUNCION = :fun
          AND ra.NUMERO_RESERVA = :num
          AND e.ESTADO = 'RESERVADA'`,
      { fun: Number(funcionId), num: Number(numeroReserva) },
      OUT_OBJ
    );
    const comprasIds = (rCompras.rows || []).map(r => Number(r.compraId));

    for (const fa of ids) {
      await cn.execute(
        `UPDATE ENTRADAS
            SET ESTADO='EMITIDA', CODIGO_QR=:qr
          WHERE ID_FA=:fa
            AND ID_COMPRA IN (SELECT ID_COMPRA FROM COMPRAS WHERE ID_FUNCION=:fun)
            AND ESTADO='RESERVADA'`,
        { fa, fun: Number(funcionId), qr: crypto.randomUUID() },
        { autoCommit: false }
      );
    }

    for (const cId of comprasIds) {
      const qPend = await cn.execute(
        `SELECT COUNT(*) AS "pend"
           FROM ENTRADAS
          WHERE ID_COMPRA=:c AND ESTADO='RESERVADA'`,
        { c: cId },
        OUT_OBJ
      );
      const quedan = Number(qPend.rows?.[0]?.pend || 0);
      if (quedan === 0) {
        await cn.execute(
          `UPDATE COMPRAS SET ESTADO='PAGADA', METODO_PAGO=:met WHERE ID_COMPRA=:c`,
          { c: cId, met: MET },
          { autoCommit: false }
        );
      }
    }

    // 4) RESERVA_ASIENTO: marcar CONFIRMADA
    await cn.execute(
      `UPDATE RESERVA_ASIENTO SET ESTADO='CONFIRMADA' WHERE NUMERO_RESERVA=:num`,
      { num: Number(numeroReserva) },
      { autoCommit: false }
    );

    // 🔸 TAQUILLA: registrar venta POS (boletos) por los asientos confirmados
    const precioUnit = await getFuncionPrecio(cn, funcionId);
    const totalBoletos = precioUnit * ids.length;
    await insertVentaTaquilla(cn, {
      usuarioId: taq.usuarioId,
      cajaId: taq.cajaId,
      total: totalBoletos,
    });

    await cn.commit();
    res.json({ ok: true, numeroReserva: Number(numeroReserva), asientos: ids.length });
  } catch (e) {
    try { if (cn) await cn.rollback(); } catch {}
    console.error('POST /confirmar-reserva ->', e);
    res.status(500).json({ message: e?.message || 'Error al confirmar la reserva' });
  } finally {
    try { if (cn) await cn.close(); } catch {}
  }
};

// ====== Generación de Ticket(s) en PDF (solo tickets, sin resumen) ======
const PDFDocument = require('pdfkit');
const qrcode = require('qrcode');

// --- helpers de formato ---
const toGTQ = (v) => `Q ${Number(v || 0).toFixed(2)}`;
const pad2 = (n) => String(n).padStart(2, '0');
const toDDMMYYYY = (iso) => {
  const d = new Date(iso);
  if (Number.isNaN(d.getTime())) return '—/—/———';
  return `${pad2(d.getDate())}/${pad2(d.getMonth() + 1)}/${d.getFullYear()}`;
};

// Normaliza hora a formato HH:MM
const normHora = (h) => {
  const s = String(h || '');
  const m = s.match(/(\d{1,2}:\d{2})/);
  return m ? m[1] : s || '—';
};

// Dibuja 1 ticket …
async function renderTicketCard(doc, meta, ent) {
  const W = doc.page.width;
  const H = doc.page.height;

  const rojo = '#e53935';
  const blanco = '#ffffff';

  const x = 12, y = 12, w = W - 24, h = H - 24;
  doc.save();
  doc.roundedRect(x, y, w, h, 14).fill(rojo);

  const left = x + 20;
  let yy = y + 24;
  doc.fill(blanco).font('Helvetica-Bold').fontSize(22).text('MovieFlow', left, yy, {
    width: w - 40, align: 'left'
  });

  yy += 34;
  const label = (t, v, dx = 0) => {
    doc.font('Helvetica').fontSize(11).fill(blanco)
       .text(`${t}: ${v}`, left + dx, yy, { width: (w - 40) / 2 - 6, align: 'left' });
  };

  label('SALA', meta.sala, 0);
  label('ASIENTO', `${ent.fila}${ent.col}`, (w - 40) / 2 + 12);
  yy += 18;

  label('FECHA', toDDMMYYYY(meta.fecha), 0);
  label('HORA', normHora(meta.hora), (w - 40) / 2 + 12);
  yy += 18;

  doc.font('Helvetica').fontSize(11).fill(blanco)
     .text(`PRECIO: ${toGTQ(ent.precio)}`, left, yy, { width: w - 40, align: 'left' });
  yy += 22;

  doc.font('Helvetica-Bold').fontSize(12).fill(blanco)
     .text(`PELÍCULA: ${meta.pelicula}`, left, yy, { width: w - 40, align: 'left' });
  yy += 28;

  const qrDataUrl = await qrcode.toDataURL(String(ent.qr || `ENTRADA:${ent.idEntrada}`), {
    errorCorrectionLevel: 'M',
    margin: 1,
    scale: 6,
  });
  const qrBase64 = qrDataUrl.replace(/^data:image\/png;base64,/, '');
  const qrBuf = Buffer.from(qrBase64, 'base64');

  const espacioRestante = (y + h) - yy - 24;
  const qrSize = Math.min(200, Math.max(120, espacioRestante));
  const qrX = x + (w - qrSize) / 2;
  doc.image(qrBuf, qrX, yy, { width: qrSize, height: qrSize });

  doc.restore();
}

// Construye el PDF …
async function buildTicketsPdfByCompra(res, cn, compraId) {
  const metaQ = await cn.execute(
    `
    SELECT
      c.ID_COMPRA        AS "compraId",
      c.MONTO_TOTAL      AS "monto",
      c.METODO_PAGO      AS "metodoPago",
      c.ESTADO           AS "estadoCompra",
      f.ID_FUNCION       AS "funcionId",
      p.TITULO           AS "pelicula",
      TO_CHAR(f.FECHA,'YYYY-MM-DD') AS "fecha",
      TO_CHAR(f.HORA_INICIO,'HH24:MI') AS "hora",
      s.NOMBRE           AS "sala"
    FROM COMPRAS c
    JOIN FUNCIONES f ON f.ID_FUNCION = c.ID_FUNCION
    JOIN PELICULA  p ON p.ID_PELICULA = f.ID_PELICULA
    JOIN SALAS     s ON s.ID_SALA     = f.ID_SALA
    WHERE c.ID_COMPRA = :c
    `,
    { c: Number(compraId) },
    OUT_OBJ
  );

  const entradasQ = await cn.execute(
    `
    SELECT
      e.ID_ENTRADA   AS "idEntrada",
      e.CODIGO_QR    AS "qr",
      e.PRECIO       AS "precio",
      a.FILA         AS "fila",
      a.COLUMNA      AS "col"
    FROM ENTRADAS e
    JOIN FUNCION_ASIENTO fa ON fa.ID_FA = e.ID_FA
    JOIN ASIENTOS a         ON a.ID_ASIENTO = fa.ID_ASIENTO
    WHERE e.ID_COMPRA = :c AND e.ESTADO = 'EMITIDA'
    ORDER BY a.FILA, a.COLUMNA
    `,
    { c: Number(compraId) },
    OUT_OBJ
  );

  const meta = metaQ.rows?.[0];
  const entradas = entradasQ.rows || [];
  if (!meta || entradas.length === 0) {
    res.status(404).json({ message: 'No hay entradas emitidas para esta compra.' });
    return;
  }

  res.setHeader('Content-Type', 'application/pdf');
  res.setHeader('Content-Disposition', `inline; filename="tickets_${meta.compraId}.pdf"`);

  const doc = new PDFDocument({ size: [360, 640], margin: 0 });
  doc.pipe(res);

  for (let i = 0; i < entradas.length; i++) {
    if (i > 0) doc.addPage({ size: [360, 640], margin: 0 });
    await renderTicketCard(doc, meta, entradas[i]);
  }

  doc.end();
}

// Endpoint: ticket por compra
exports.getTicketsPdfByCompra = async (req, res) => {
  let cn;
  try {
    const compraId = Number(req.params.compraId);
    cn = await db.getConnection();
    await buildTicketsPdfByCompra(res, cn, compraId);
  } catch (e) {
    console.error('GET /empleado/tickets/compra/:compraId ->', e);
    try { res.status(500).json({ message: 'No se pudo generar el PDF' }); } catch {}
  } finally {
    try { if (cn) await cn.close(); } catch {}
  }
};

// (Opcional) ticket(s) por número de reserva confirmada
exports.getTicketsPdfByReserva = async (req, res) => {
  let cn;
  try {
    const { funcionId, numeroReserva } = req.params;
    cn = await db.getConnection();

    const r = await cn.execute(
      `
      SELECT DISTINCT c.ID_COMPRA AS "compraId"
      FROM ENTRADAS e
      JOIN COMPRAS  c ON c.ID_COMPRA = e.ID_COMPRA
      JOIN RESERVA_ASIENTO ra ON ra.ID_FA = e.ID_FA
      JOIN FUNCION_ASIENTO fa ON fa.ID_FA = e.ID_FA
      WHERE c.ID_FUNCION = :fun
        AND ra.NUMERO_RESERVA = :num
        AND e.ESTADO = 'EMITIDA'
      `,
      { fun: Number(funcionId), num: Number(numeroReserva) },
      OUT_OBJ
    );
    const compraId = r.rows?.[0]?.compraId;
    if (!compraId) return res.status(404).json({ message: 'No hay entradas emitidas para esa reserva.' });

    await buildTicketsPdfByCompra(res, cn, compraId);
  } catch (e) {
    console.error('GET /empleado/funciones/:funcionId/reservas/:numeroReserva/tickets ->', e);
    try { res.status(500).json({ message: 'No se pudo generar el PDF' }); } catch {}
  } finally {
    try { if (cn) await cn.close(); } catch {}
  }
};
