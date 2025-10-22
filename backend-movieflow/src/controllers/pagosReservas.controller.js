// src/controllers/pagosReservas.controller.js
const db = require('../config/db');
const oracledb = require('oracledb');
oracledb.outFormat = oracledb.OUT_FORMAT_OBJECT;

/* ══════════════════════════════════════════════════════
   Helper para obtener apertura activa por usuario
   (se deja por compatibilidad; no se usa aquí)
   ══════════════════════════════════════════════════════ */
async function getAperturaActivaPorUsuario(connection, usuarioId) {
  const sql = `
    SELECT ID_APERTURA
      FROM POS_APERTURA_CAJA
     WHERE USUARIO_ID = :usuarioId
       AND ESTADO_ID = 1
     ORDER BY FECHA_APERTURA DESC, HORA_APERTURA DESC
     FETCH FIRST 1 ROWS ONLY`;
  const rs = await connection.execute(sql, { usuarioId });
  return rs.rows[0]?.ID_APERTURA || null;
}

/* ══════════════════════════════════════════════════════
   GET /api/pagos-reservas/por-cobrar
   ══════════════════════════════════════════════════════ */
exports.listarPorCobrar = async (req, res) => {
  let cn;
  try {
    cn = await db.getConnection();

    const { desde, hasta } = req.query;
    const binds = {};
    let where = `
      e.ESTADO IN ('RESERVADO','CONFIRMADO')
      AND NOT EXISTS (SELECT 1 FROM POS_PAGO_EVENTO p WHERE p.EVENTO_ID = e.ID_EVENTO)
    `;
    if (desde) {
      where += ` AND e.START_TS >= TO_TIMESTAMP(:desde || ' 00:00:00', 'YYYY-MM-DD HH24:MI:SS')`;
      binds.desde = desde;
    }
    if (hasta) {
      where += ` AND e.START_TS <= TO_TIMESTAMP(:hasta || ' 23:59:59', 'YYYY-MM-DD HH24:MI:SS')`;
      binds.hasta = hasta;
    }

    const q = `
      SELECT 
        e.ID_EVENTO,
        e.SALA_ID,
        s.NOMBRE AS SALA_NOMBRE,
        e.START_TS,
        e.END_TS,
        e.DURACION_MIN,
        e.PERSONAS,
        e.NOTAS,
        e.ESTADO
      FROM ESTUDIANTE.EVENTOS_ESPECIALES e
      LEFT JOIN ESTUDIANTE.SALAS s
        ON s.ID_SALA = e.SALA_ID
      WHERE ${where}
      ORDER BY e.START_TS ASC
    `;

    const r = await cn.execute(q, binds);
    return res.json({ ok: true, count: r.rows.length, data: r.rows });
  } catch (err) {
    console.error('❌ listarPorCobrar:', err);
    res.status(500).json({ ok: false, error: 'Error al listar reservas por cobrar', detail: err.message });
  } finally {
    try { await cn.close(); } catch {}
  }
};


/* ══════════════════════════════════════════════════════
   POST /api/pagos-reservas
   Permite pagar eventos en ESTADO = 'RESERVADO' o 'CONFIRMADO'.
   ► SIEMPRE usa la apertura activa de "Caja Taquilla".
   ══════════════════════════════════════════════════════ */
exports.pagarEvento = async (req, res) => {
  let cn;
  try {
    const eventoId  = Number(req.body?.eventoId);
    const usuarioId = Number(req.headers['x-user-id'] || req.body?.usuarioId);
    const obs       = (req.body?.obs || '').trim() || null;

    if (!eventoId || !usuarioId) {
      return res.status(400).json({ ok:false, error:'Faltan parámetros (eventoId, usuarioId)' });
    }

    cn = await db.getConnection();

    // 1) Evento + estado + fecha + duración (FOR UPDATE)
    const sqlEvt = `
      SELECT ID_EVENTO, ESTADO, START_TS, DURACION_MIN
        FROM ESTUDIANTE.EVENTOS_ESPECIALES
       WHERE ID_EVENTO = :1
       FOR UPDATE`;
    const rEvt = await cn.execute(sqlEvt, [eventoId], { outFormat: oracledb.OUT_FORMAT_OBJECT });
    if (!rEvt.rows.length) return res.status(404).json({ ok:false, error:'Evento no encontrado' });

    const evt     = rEvt.rows[0];
    const estado  = String(evt.ESTADO || '').toUpperCase();
    const dMinRaw = evt.DURACION_MIN ?? evt.DURACIONMIN;
    const durMin  = Number(dMinRaw);

    if (!Number.isFinite(durMin)) {
      return res.status(400).json({ ok:false, error:'Duración del evento inválida' });
    }

    // 2) Tarifa por duración
    //    - 150 min o menos  => Q 3,500
    //    - 180 min o más    => Q 4,500
    //    - (151–179)        => Q 3,500
    const tarifa = (durMin <= 150) ? 3500 : (durMin >= 180 ? 4500 : 3500);

    // 3) Regla: pagar HASTA el día anterior al evento
    const sqlRegla = `SELECT CASE WHEN TRUNC(SYSDATE) <= TRUNC(:1) - 1 THEN 1 ELSE 0 END AS OK FROM dual`;
    const rRegla = await cn.execute(sqlRegla, [evt.START_TS], { outFormat: oracledb.OUT_FORMAT_OBJECT });
    if (!rRegla.rows[0].OK) {
      return res.status(400).json({ ok:false, error:'Fuera de tiempo: el pago solo se permite hasta el día anterior al evento.' });
    }

    // 4) Apertura ACTIVA de **CAJA TAQUILLA**
    const rTaquilla = await cn.execute(
      `
      SELECT a.ID_APERTURA AS APERTURA_ID
        FROM POS_APERTURA_CAJA a
        JOIN POS_CAJAS c ON c.ID_CAJA = a.CAJA_ID
       WHERE a.ESTADO_ID = 1
         AND UPPER(TRIM(c.NOMBRE_CAJA)) = 'CAJA TAQUILLA'
       ORDER BY a.FECHA_APERTURA DESC, a.HORA_APERTURA DESC
       FETCH FIRST 1 ROWS ONLY
      `,
      {},
      { outFormat: oracledb.OUT_FORMAT_OBJECT }
    );
    if (!rTaquilla.rows.length) {
      return res.status(400).json({
        ok:false,
        error:'No hay una "Caja Taquilla" aperturada. Abra la Caja Taquilla para registrar pagos de reservas.'
      });
    }
    const aperturaIdTaquilla = Number(rTaquilla.rows[0].APERTURA_ID);

    // 5) Registrar pago
    if (estado === 'CONFIRMADO') {
      // Si usas el SP, luego movemos el registro a la apertura de Taquilla
      await cn.execute(
        `BEGIN ESTUDIANTE.PR_PAGAR_EVENTO_EFECTIVO(:1, :2, :3, :4); END;`,
        [ eventoId, tarifa, usuarioId, obs ]
      );

      await cn.execute(
        `UPDATE POS_PAGO_EVENTO
            SET APERTURA_ID = :apertura
          WHERE EVENTO_ID = :evt`,
        { apertura: aperturaIdTaquilla, evt: eventoId }
      );

    } else if (estado === 'RESERVADO') {
      // Insert directo amarrado a la apertura de Taquilla
      await cn.execute(
        `
        INSERT INTO POS_PAGO_EVENTO
          (APERTURA_ID, EVENTO_ID, MONTO_GTQ, USUARIO_ID, OBS)
        VALUES
          (:apertura, :evento, :monto, :usuario, :obs)
        `,
        {
          apertura: aperturaIdTaquilla,
          evento:   eventoId,
          monto:    tarifa,
          usuario:  usuarioId,
          obs
        }
      );
      // Estado permanece RESERVADO; ya no aparece "por cobrar" porque existe pago.

    } else {
      return res.status(400).json({ ok:false, error:`Estado inválido para pago: ${estado}` });
    }

    await cn.commit();
    return res.json({
      ok:true,
      message:'Pago registrado (Caja Taquilla)',
      montoCargado: tarifa,
      duracionMin: durMin
    });

  } catch (err) {
    if (cn) try { await cn.rollback(); } catch {}
    console.error('❌ pagarEvento:', err);
    const msg = (err && err.message || '').replace(/ORA-\d+:\s*/g, '').trim() || 'Error al registrar el pago';
    return res.status(400).json({ ok:false, error: msg });
  } finally {
    if (cn) try { await cn.close(); } catch {}
  }
};


/* ══════════════════════════════════════════════════════
   GET /api/pagos-reservas/ingresos
   ══════════════════════════════════════════════════════ */
exports.ingresos = async (req, res) => {
  let cn;
  try {
    cn = await db.getConnection();
    const range = (req.query?.range || 'dia').toLowerCase();

    let sql;
    if (range === 'semana') {
      sql = `
        SELECT TRUNC(CAST(FECHA_PAGO AS DATE)) AS DIA, SUM(MONTO_GTQ) AS TOTAL
          FROM POS_PAGO_EVENTO
         WHERE CAST(FECHA_PAGO AS DATE) >= TRUNC(SYSDATE) - 6
         GROUP BY TRUNC(CAST(FECHA_PAGO AS DATE))
         ORDER BY DIA
      `;
    } else if (range === 'mes') {
      sql = `
        SELECT TRUNC(CAST(FECHA_PAGO AS DATE)) AS DIA, SUM(MONTO_GTQ) AS TOTAL
          FROM POS_PAGO_EVENTO
         WHERE CAST(FECHA_PAGO AS DATE) >= TRUNC(ADD_MONTHS(SYSDATE,0),'MM')
           AND CAST(FECHA_PAGO AS DATE) <  TRUNC(ADD_MONTHS(SYSDATE,1),'MM')
         GROUP BY TRUNC(CAST(FECHA_PAGO AS DATE))
         ORDER BY DIA
      `;
    } else {
      sql = `
        SELECT TRUNC(CAST(FECHA_PAGO AS DATE)) AS DIA, SUM(MONTO_GTQ) AS TOTAL
          FROM POS_PAGO_EVENTO
         WHERE TRUNC(CAST(FECHA_PAGO AS DATE)) = TRUNC(SYSDATE)
         GROUP BY TRUNC(CAST(FECHA_PAGO AS DATE))
         ORDER BY DIA
      `;
    }

    const rs = await cn.execute(sql);
    return res.json({ ok: true, range, data: rs.rows });
  } catch (err) {
    console.error('❌ ingresos:', err);
    res.status(500).json({ ok: false, error: 'Error al calcular ingresos', detail: err.message });
  } finally {
    try { await cn.close(); } catch {}
  }
};

/* ══════════════════════════════════════════════════════
   GET /api/pagos-reservas/resumen-cobro
   ══════════════════════════════════════════════════════ */
exports.resumenCobro = async (req, res) => {
  let cn;
  try {
    cn = await db.getConnection();
    const sql = `
      SELECT ESTADO_COBRO, COUNT(*) AS CANT
        FROM POS_V_RESERVAS_COBRO
       GROUP BY ESTADO_COBRO
    `;
    const rs = await cn.execute(sql);
    const map = rs.rows.reduce((acc, r) => {
      acc[r.ESTADO_COBRO] = Number(r.CANT);
      return acc;
    }, { PAGADA: 0, POR_COBRAR: 0 });
    return res.json({ ok: true, ...map });
  } catch (err) {
    console.error('❌ resumenCobro:', err);
    res.status(500).json({ ok: false, error: 'Error al obtener resumen de cobro', detail: err.message });
  } finally {
    try { await cn.close(); } catch {}
  }
};
