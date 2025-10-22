// backend-movieflow/src/routes/ventasBoletos.js
const express = require('express');
const oracledb = require('oracledb');
const db = require('../config/db');
const router = express.Router();

/* === calcular rango según scope del dashboard === */
function getRange(scope = 'mes') {
  const today = new Date();
  // "end" = hoy 00:00; el rango será [start, endExcl)
  const end = new Date(today.getFullYear(), today.getMonth(), today.getDate());
  let start;
  if (scope === 'dia') {
    start = new Date(end); // solo hoy
  } else if (scope === 'semana') {
    start = new Date(end);
    start.setDate(end.getDate() - 6); // últimos 7 días incluyendo hoy
  } else {
    start = new Date(end.getFullYear(), end.getMonth(), 1); // mes actual
  }
  const endExcl = new Date(end);
  endExcl.setDate(endExcl.getDate() + 1); // mañana 00:00 (excluyente)
  return { start, endExcl };
}

/* === GET /api/ventas-boletos/resumen?scope=dia|semana|mes === */
router.get('/api/ventas-boletos/resumen', async (req, res) => {
  const scope = String(req.query.scope || 'mes').toLowerCase();
  const { start, endExcl } = getRange(scope);

  // Serie: por día usando fecha de venta/emisión
  const SQL_SERIE = `
    SELECT
      TRUNC(NVL(e.FECHA, NVL(c.FECHA, f.FECHA))) AS FECHA,
      SUM(NVL(e.PRECIO, f.PRECIO))               AS TOTAL,
      COUNT(e.ID_ENTRADA)                         AS BOLETOS
    FROM FUNCIONES f
    JOIN FUNCION_ASIENTO fa ON fa.ID_FUNCION = f.ID_FUNCION
    JOIN ENTRADAS e         ON e.ID_FA       = fa.ID_FA
    JOIN COMPRAS  c         ON c.ID_COMPRA   = e.ID_COMPRA
    WHERE
      NVL(e.FECHA, NVL(c.FECHA, f.FECHA)) >= :desde
      AND NVL(e.FECHA, NVL(c.FECHA, f.FECHA)) <  :hasta_excl
      AND (e.ESTADO IN ('EMITIDA','PAGADA','CONFIRMADA') OR e.ESTADO IS NULL)
      AND c.ESTADO IN ('CONFIRMADA','PAGADA','FINALIZADA')
    GROUP BY TRUNC(NVL(e.FECHA, NVL(c.FECHA, f.FECHA)))
    ORDER BY FECHA
  `;

  // Top películas: incluir ventas sin película (LEFT JOIN) como "(Sin título)"
  const SQL_TOP = `
    SELECT
      NVL(p.TITULO, '(Sin título)')              AS TITULO,
      SUM(NVL(e.PRECIO, f.PRECIO))               AS TOTAL
    FROM FUNCIONES f
    LEFT JOIN PELICULA p    ON p.ID_PELICULA = f.ID_PELICULA
    JOIN FUNCION_ASIENTO fa ON fa.ID_FUNCION = f.ID_FUNCION
    JOIN ENTRADAS e         ON e.ID_FA       = fa.ID_FA
    JOIN COMPRAS  c         ON c.ID_COMPRA   = e.ID_COMPRA
    WHERE
      NVL(e.FECHA, NVL(c.FECHA, f.FECHA)) >= :desde
      AND NVL(e.FECHA, NVL(c.FECHA, f.FECHA)) <  :hasta_excl
      AND (e.ESTADO IN ('EMITIDA','PAGADA','CONFIRMADA') OR e.ESTADO IS NULL)
      AND c.ESTADO IN ('CONFIRMADA','PAGADA','FINALIZADA')
    GROUP BY NVL(p.TITULO, '(Sin título)')
    ORDER BY TOTAL DESC
    FETCH FIRST 5 ROWS ONLY
  `;

  let cn;
  try {
    cn = await db.getConnection();
    const binds = {
      desde:      { val: start,   type: oracledb.DB_TYPE_DATE },
      hasta_excl: { val: endExcl, type: oracledb.DB_TYPE_DATE },
    };

    const serieRs = await cn.execute(SQL_SERIE, binds, { outFormat: oracledb.OUT_FORMAT_OBJECT });
    const topRs   = await cn.execute(SQL_TOP,   binds, { outFormat: oracledb.OUT_FORMAT_OBJECT });

    const toISO = (d) =>
      `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, '0')}-${String(d.getDate()).padStart(2, '0')}`;

    const serie = (serieRs.rows || []).map(r => ({
      fecha: toISO(r.FECHA),
      total: Number(r.TOTAL || 0),
      boletos: Number(r.BOLETOS || 0),
    }));

    const top = (topRs.rows || []).map(r => ({
      titulo: r.TITULO || '—',
      total: Number(r.TOTAL || 0),
    }));

    res.json({ serie, top });
  } catch (err) {
    console.error('ventas-boletos/resumen error:', err);
    res.status(500).json({ serie: [], top: [] });
  } finally {
    try { if (cn) await cn.close(); } catch {}
  }
});

module.exports = router;
