// src/controllers/filters/filtros.controller.js
const oracledb = require('oracledb');
const db = require('../../config/db');
const OUT_OBJ = { outFormat: oracledb.OUT_FORMAT_OBJECT };

/**
 * Lista de salas para filtros (solo id y nombre) + opción "Todos".
 * GET /api/filtros/salas
 */
async function getSalasFiltro(req, res) {
  const SQL = `
    SELECT
      s.id_sala AS id_sala,
      s.nombre  AS nombre
    FROM salas s
    ORDER BY s.nombre
  `;
  let cn;
  try {
    cn = await db.getConnection();
    const result = await cn.execute(SQL, {}, OUT_OBJ);

    // Opción "Todos" al inicio (id_sala = null)
    const rows = [{ id_sala: null, nombre: 'Todos' }, ...result.rows];

    return res.json({ ok: true, rows });
  } catch (err) {
    console.error('Error getSalasFiltro:', err);
    return res.status(500).json({ ok:false, msg:'Error al listar salas (filtro)' });
  } finally {
    try { if (cn) await cn.close(); } catch {}
  }
}

module.exports = { getSalasFiltro };
