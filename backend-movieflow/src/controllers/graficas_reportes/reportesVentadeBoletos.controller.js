// src/controllers/graficas_reportes/reportesVentadeBoletos.controller.js
const oracledb = require('oracledb');
const db = require('../../config/db');
const OUT_OBJ = { outFormat: oracledb.OUT_FORMAT_OBJECT };

function normalizeModo(m) {
  const v = String(m || 'TODOS').trim().toUpperCase();
  return ['TODOS', 'HOY', 'SEMANA', 'MES', 'PERSONALIZADO'].includes(v) ? v : 'TODOS';
}
function parseISODate(s) {
  if (!s || typeof s !== 'string') return null;
  const m = s.match(/^(\d{4})-(\d{2})-(\d{2})$/);
  if (!m) return null;
  const d = new Date(+m[1], +m[2] - 1, +m[3], 0, 0, 0, 0);
  return Number.isNaN(d.getTime()) ? null : d;
}
const toOraDate = (d) => (d instanceof Date && !Number.isNaN(d.getTime()) ? d : null);

async function getReporteVentaBoletos(req, res) {
  const salaIdRaw = req.query.salaId;
  const salaId = (salaIdRaw === '' || salaIdRaw === undefined || salaIdRaw === null)
    ? null
    : Number(salaIdRaw);

  const modo = normalizeModo(req.query.modo);

  let desde = null, hasta = null;
  if (modo === 'PERSONALIZADO') {
    desde = parseISODate(req.query.desde);
    hasta = parseISODate(req.query.hasta);
    if (!desde || !hasta) {
      return res.status(400).json({ ok: false, msg: "Para 'PERSONALIZADO' envía 'desde' y 'hasta' como YYYY-MM-DD." });
    }
    // incluir todo el día 'hasta'
    hasta = new Date(hasta.getFullYear(), hasta.getMonth(), hasta.getDate(), 23, 59, 59, 999);
  }

  const SQL = `
    WITH rango AS (
      SELECT
        CASE
          WHEN :modo = 'HOY'           THEN TRUNC(SYSDATE)
          WHEN :modo = 'SEMANA'        THEN TRUNC(SYSDATE, 'IW')
          WHEN :modo = 'MES'           THEN TRUNC(SYSDATE, 'MM')
          WHEN :modo = 'PERSONALIZADO' THEN TRUNC(:desde)
          ELSE DATE '1900-01-01'
        END AS ini,
        CASE
          WHEN :modo = 'HOY'           THEN TRUNC(SYSDATE) + 1
          WHEN :modo = 'SEMANA'        THEN TRUNC(SYSDATE, 'IW') + 7
          WHEN :modo = 'MES'           THEN ADD_MONTHS(TRUNC(SYSDATE, 'MM'), 1)
          WHEN :modo = 'PERSONALIZADO' THEN TRUNC(:hasta) + 1
          ELSE DATE '2999-12-31'
        END AS fin_excl
      FROM dual
    )
    SELECT
      s.nombre                             AS sala,
      COUNT(DISTINCT f.id_funcion)         AS funciones,
      MAX(s.capacidad)                     AS capacidad,
      COUNT(e.id_entrada)                  AS boletos_vendidos,
      NVL(SUM(NVL(e.precio, f.precio)),0)  AS total_ingresos,
      MIN(
        CASE
          WHEN :modo = 'TODOS' THEN 'Todos'
          WHEN :modo = 'HOY'   THEN TO_CHAR(r.ini, 'DD/MM/YYYY')
          WHEN :modo = 'MES'   THEN TO_CHAR(r.ini, 'MM/YYYY')
          WHEN :modo IN ('SEMANA','PERSONALIZADO')
             THEN TO_CHAR(r.ini, 'DD/MM/YYYY') || ' a ' || TO_CHAR(r.fin_excl - 1, 'DD/MM/YYYY')
          ELSE NULL
        END
      ) AS fecha
    FROM salas s
    JOIN funciones f        ON f.id_sala    = s.id_sala
    JOIN funcion_asiento fa ON fa.id_funcion= f.id_funcion
    JOIN entradas e         ON e.id_fa      = fa.id_fa
    JOIN compras  c         ON c.id_compra  = e.id_compra
    JOIN rango   r          ON 1=1
    WHERE (:salaId IS NULL OR s.id_sala = :salaId)

      /* ⬇️⬇️ CAMBIO CLAVE: usar FECHA DE VENTA/EMISIÓN (igual que el Dashboard) */
      AND (
        :modo = 'TODOS'
        OR (
          NVL(e.fecha, NVL(c.fecha, f.fecha)) >= r.ini
          AND NVL(e.fecha, NVL(c.fecha, f.fecha)) <  r.fin_excl
        )
      )

      /* mismos estados que el dashboard */
      AND c.estado IN ('PAGADA','CONFIRMADA','FINALIZADA')
      AND (e.estado IN ('EMITIDA','PAGADA','CONFIRMADA') OR e.estado IS NULL)
    GROUP BY s.nombre
    ORDER BY s.nombre
  `;

  const binds = {
    salaId: { val: Number.isFinite(salaId) ? salaId : null, type: oracledb.DB_TYPE_NUMBER },
    modo,
    desde:  { val: modo === 'PERSONALIZADO' ? toOraDate(desde) : null, type: oracledb.DB_TYPE_DATE },
    hasta:  { val: modo === 'PERSONALIZADO' ? toOraDate(hasta) : null, type: oracledb.DB_TYPE_DATE }
  };

  let cn;
  try {
    cn = await db.getConnection();
    const result = await cn.execute(SQL, binds, OUT_OBJ);

    return res.json({
      ok: true,
      params: { salaId: salaId ?? null, modo, desde: req.query.desde || null, hasta: req.query.hasta || null },
      rows: result.rows
    });
  } catch (err) {
    console.error('Error getReporteVentaBoletos:', err);
    return res.status(500).json({ ok: false, msg: 'Error al obtener el reporte', error: String(err?.message || err) });
  } finally {
    try { if (cn) await cn.close(); } catch {}
  }
}

module.exports = { getReporteVentaBoletos };
