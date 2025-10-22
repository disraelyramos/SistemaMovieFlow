// src/controllers/reportesEventos.controller.js
const oracledb = require('oracledb');
const db = require('../config/db');

exports.listar = async (req, res) => {
  let cn;
  try {
    const desde   = req.query.desde || null;
    const hasta   = req.query.hasta || null;
    const salaId  = req.query.salaId ? Number(req.query.salaId) : null;
    const estado  = req.query.estado ? String(req.query.estado).toUpperCase() : null;

    cn = await db.getConnection();

    const sql = `
      SELECT
        e.ID_EVENTO,
        e.SALA_ID,
        ('Sala ' || e.SALA_ID)                                  AS SALA_NOMBRE,
        e.START_TS,
        e.END_TS,
        e.PERSONAS,
        UPPER(e.ESTADO)                                         AS ESTADO,           -- estado "de la tabla"
        -- total pagado
        NVL((SELECT SUM(p.MONTO_GTQ)
              FROM POS_PAGO_EVENTO p
             WHERE p.EVENTO_ID = e.ID_EVENTO), 0)               AS MONTO_GTQ,
        -- flag: 1 si tiene pago, 0 si no
        CASE WHEN EXISTS (SELECT 1 FROM POS_PAGO_EVENTO pp WHERE pp.EVENTO_ID = e.ID_EVENTO)
             THEN 1 ELSE 0 END                                  AS TIENE_PAGO,
        -- "estado factual": si tiene pago => 'PAGADO', si no, el de la tabla
        CASE WHEN EXISTS (SELECT 1 FROM POS_PAGO_EVENTO pp WHERE pp.EVENTO_ID = e.ID_EVENTO)
             THEN 'PAGADO' ELSE UPPER(e.ESTADO) END             AS ESTADO_FACT,
        NULL                                                    AS CLIENTE_EMAIL,
        NULL                                                    AS NOTAS
      FROM ESTUDIANTE.EVENTOS_ESPECIALES e
      WHERE 1=1
        AND (:p_desde IS NULL OR TRUNC(e.START_TS) >= TO_DATE(:p_desde, 'YYYY-MM-DD'))
        AND (:p_hasta IS NULL OR TRUNC(e.START_TS) <= TO_DATE(:p_hasta, 'YYYY-MM-DD'))
        AND (:p_sala  IS NULL OR e.SALA_ID = :p_sala)
        -- ✅ CORREGIDO: Filtrar por estado pero solo mostrar eventos con pagos cuando el estado es PAGADO
        AND (
          (:p_estado IS NULL) OR
          (:p_estado = 'PAGADO' AND EXISTS (SELECT 1 FROM POS_PAGO_EVENTO pp WHERE pp.EVENTO_ID = e.ID_EVENTO)) OR
          (:p_estado != 'PAGADO' AND UPPER(e.ESTADO) = :p_estado)
        )
      ORDER BY e.START_TS DESC`;

    const binds = { p_desde: desde, p_hasta: hasta, p_sala: salaId, p_estado: estado };

    const r = await cn.execute(sql, binds, { outFormat: oracledb.OUT_FORMAT_OBJECT });
    res.json({ ok: true, eventos: r.rows });
  } catch (err) {
    console.error('❌ /api/reportes/eventos error:', err);
    res.status(500).json({ ok:false, message: 'No se pudo obtener el reporte de eventos' });
  } finally {
    if (cn) try { await cn.close(); } catch {}
  }
};