// backend-movieflow/src/controllers/inventario/productoPorLote.controller.js
const db = require('../../config/db');
const oracledb = require('oracledb');

const OUT = { outFormat: oracledb.OUT_FORMAT_OBJECT };
const SCHEMA = process.env.DB_SCHEMA ? `${process.env.DB_SCHEMA}.` : ''; // ej: ESTUDIANTE.

// ------------------ helpers ------------------
function toISODate(s) {
  // Acepta "YYYY-MM-DD" o "DD/MM/YYYY"
  if (!s || typeof s !== 'string') return null;
  if (/^\d{4}-\d{2}-\d{2}$/.test(s)) return s;
  const m = /^(\d{2})\/(\d{2})\/(\d{4})$/.exec(s);
  if (m) return `${m[3]}-${m[2]}-${m[1]}`;
  return null;
}

// ------------------ CREAR (POST) ------------------
/**
 * POST /api/producto-por-lote
 * Body:
 *  - productoId (number)   -> requerido
 *  - loteId     (number)   -> requerido (de POS_PRODUCTO_LOTE)
 *  - cantidad   (number)   -> requerido (>= 0)
 *  - fechaVencimiento (opcional) -> "YYYY-MM-DD" o "DD/MM/YYYY"; "" para null
 *
 * Crea una fila en POS_PRODUCTO_POR_LOTE y retorna el registro creado con join a POS_PRODUCTO_LOTE.
 */
exports.crearPorLote = async (req, res) => {
  const productoId = Number(req.body.productoId);
  const loteId     = Number(req.body.loteId);
  const cantidad   = Number(req.body.cantidad);
  const fvRaw      = req.body.fechaVencimiento;

  if (!Number.isFinite(productoId) || productoId <= 0) {
    return res.status(400).json({ message: 'productoId inválido' });
  }
  if (!Number.isFinite(loteId) || loteId <= 0) {
    return res.status(400).json({ message: 'loteId inválido' });
  }
  if (!Number.isFinite(cantidad) || cantidad < 0) {
    return res.status(400).json({ message: 'cantidad debe ser numérica y >= 0' });
  }

  let fvISO = null;
  if (fvRaw !== undefined && fvRaw !== null && fvRaw !== '') {
    fvISO = toISODate(String(fvRaw));
    if (!fvISO) return res.status(400).json({ message: 'fechaVencimiento inválida' });
  }

  let cn;
  try {
    cn = await db.getConnection();

    // Verificar existencia de PRODUCTO y LOTE
    const [pRS, lRS] = await Promise.all([
      cn.execute(`SELECT 1 FROM ${SCHEMA}POS_PRODUCTO_NUEVO WHERE ID = :id`, { id: productoId }, OUT),
      cn.execute(`SELECT 1 FROM ${SCHEMA}POS_PRODUCTO_LOTE  WHERE ID = :id`, { id: loteId }, OUT),
    ]);
    if (!pRS.rows.length) return res.status(404).json({ message: 'Producto no encontrado.' });
    if (!lRS.rows.length) return res.status(404).json({ message: 'Lote no encontrado.' });

    // Insert
    const binds = {
      productoId,
      loteId,
      cantidad,
    };
    const cols = ['PRODUCTO_ID', 'LOTE_ID', 'CANTIDAD_DISPONIBLE'];
    const vals = [':productoId', ':loteId', ':cantidad'];

    if (fvISO) {
      binds.fv = fvISO;
      cols.push('FECHA_VENCIMIENTO');
      vals.push(`TO_DATE(:fv,'YYYY-MM-DD')`);
    }

    const ins = await cn.execute(
      `INSERT INTO ${SCHEMA}POS_PRODUCTO_POR_LOTE (${cols.join(', ')})
       VALUES (${vals.join(', ')})
       RETURNING ID_POR_LOTE INTO :idPorLote`,
      { ...binds, idPorLote: { dir: oracledb.BIND_OUT, type: oracledb.NUMBER } },
      { autoCommit: false }
    );

    const idPorLote = ins.outBinds.idPorLote[0];

    // Traer registro creado con JOIN para devolver datos completos
    const rs = await cn.execute(
      `
      SELECT
        ppl.ID_POR_LOTE                          AS "ID",
        ppl.LOTE_ID                              AS "LOTE_ID",
        ppl.PRODUCTO_ID                          AS "PRODUCTO_ID",
        NVL(ppl.CANTIDAD_DISPONIBLE, 0)          AS "CANTIDAD_DISPONIBLE",
        ppl.FECHA_VENCIMIENTO                    AS "FECHA_VENCIMIENTO",
        TO_CHAR(ppl.FECHA_VENCIMIENTO,'DD/MM/YYYY') AS "FECHA_VENCIMIENTO_TX",
        pl.CODIGO_LOTE                           AS "CODIGO_LOTE",
        pl.NOMBRE                                AS "NOMBRE_LOTE"
      FROM ${SCHEMA}POS_PRODUCTO_POR_LOTE ppl
      LEFT JOIN ${SCHEMA}POS_PRODUCTO_LOTE pl
        ON pl.ID = ppl.LOTE_ID
      WHERE ppl.ID_POR_LOTE = :id
      `,
      { id: idPorLote },
      OUT
    );

    await cn.commit();

    const r = rs.rows[0];
    return res.status(201).json({
      id: r.ID,
      loteId: r.LOTE_ID,
      loteCodigo: r.CODIGO_LOTE || null,
      loteNombre: r.NOMBRE_LOTE || null,
      productoId: r.PRODUCTO_ID,
      cantidadDisponible: Number(r.CANTIDAD_DISPONIBLE || 0),
      fechaVencimiento: r.FECHA_VENCIMIENTO || null,
      fechaVencimientoTx: r.FECHA_VENCIMIENTO_TX || null,
    });
  } catch (err) {
    if (cn) try { await cn.rollback(); } catch {}
    console.error('❌ Error crearPorLote:', err);
    return res.status(500).json({ message: 'Error al crear lote del producto.' });
  } finally {
    if (cn) try { await cn.close(); } catch {}
  }
};

// ------------------ LISTAR POR PRODUCTO ------------------
/**
 * GET /api/producto-por-lote?productoId=4
 */
exports.listarPorProducto = async (req, res) => {
  const productoId = Number(req.query.productoId);
  if (!Number.isFinite(productoId)) {
    return res.status(400).json({ message: 'productoId inválido' });
  }

  let cn;
  try {
    cn = await db.getConnection();

    const rs = await cn.execute(
      `
      SELECT
        ppl.ID_POR_LOTE                          AS "ID",
        ppl.LOTE_ID                              AS "LOTE_ID",
        ppl.PRODUCTO_ID                          AS "PRODUCTO_ID",
        NVL(ppl.CANTIDAD_DISPONIBLE, 0)          AS "CANTIDAD_DISPONIBLE",
        ppl.FECHA_VENCIMIENTO                    AS "FECHA_VENCIMIENTO",
        TO_CHAR(ppl.FECHA_VENCIMIENTO,'DD/MM/YYYY') AS "FECHA_VENCIMIENTO_TX",
        pl.CODIGO_LOTE                           AS "CODIGO_LOTE",
        pl.NOMBRE                                AS "NOMBRE_LOTE"
      FROM ${SCHEMA}POS_PRODUCTO_POR_LOTE ppl
      LEFT JOIN ${SCHEMA}POS_PRODUCTO_LOTE pl
        ON pl.ID = ppl.LOTE_ID
      WHERE ppl.PRODUCTO_ID = :id
      ORDER BY ppl.FECHA_VENCIMIENTO NULLS LAST, ppl.ID_POR_LOTE DESC
      `,
      { id: productoId },
      OUT
    );

    const out = (rs.rows || []).map(r => ({
      id: r.ID,
      loteId: r.LOTE_ID,
      loteCodigo: r.CODIGO_LOTE || null,
      loteNombre: r.NOMBRE_LOTE || null,
      productoId: r.PRODUCTO_ID,
      cantidadDisponible: Number(r.CANTIDAD_DISPONIBLE || 0),
      fechaVencimiento: r.FECHA_VENCIMIENTO || null,
      fechaVencimientoTx: r.FECHA_VENCIMIENTO_TX || null,
    }));

    return res.json(out);
  } catch (err) {
    console.error('❌ Error listarPorProducto:', err);
    return res.status(500).json({ message: 'Error al listar lotes del producto.' });
  } finally {
    if (cn) try { await cn.close(); } catch {}
  }
};

// ------------------ ACTUALIZAR LOTE ------------------
/**
 * PUT /api/producto-por-lote/:idPorLote
 * Body:
 *  - cantidad (opcional) -> DELTA para sumar/restar (ej. 5 ó -3)
 *  - fechaVencimiento (opcional) -> "YYYY-MM-DD" o "DD/MM/YYYY"; "" para limpiar
 */
exports.actualizarPorLote = async (req, res) => {
  const idPorLote = Number(req.params.idPorLote);
  if (!Number.isFinite(idPorLote)) {
    return res.status(400).json({ message: 'ID de lote inválido' });
  }

  const { cantidad, fechaVencimiento } = req.body;

  const sets = [];
  const binds = { id: idPorLote };

  // cantidad = delta opcional
  if (cantidad !== undefined && cantidad !== '') {
    const delta = Number(cantidad);
    if (Number.isNaN(delta) || delta === 0) {
      return res.status(400).json({ message: 'cantidad debe ser numérica y distinta de 0' });
    }
    sets.push('CANTIDAD_DISPONIBLE = NVL(CANTIDAD_DISPONIBLE,0) + :delta');
    binds.delta = delta;
  }

  // fechaVencimiento opcional
  if (fechaVencimiento !== undefined) {
    if (fechaVencimiento === '' || fechaVencimiento === null) {
      sets.push('FECHA_VENCIMIENTO = NULL');
    } else {
      const iso = toISODate(fechaVencimiento);
      if (!iso) return res.status(400).json({ message: 'fechaVencimiento inválida' });
      sets.push(`FECHA_VENCIMIENTO = TO_DATE(:fv,'YYYY-MM-DD')`);
      binds.fv = iso;
    }
  }

  if (sets.length === 0) {
    return res.status(400).json({ message: 'No hay cambios para aplicar.' });
  }

  let cn;
  try {
    cn = await db.getConnection();

    const up = await cn.execute(
      `
      UPDATE ${SCHEMA}POS_PRODUCTO_POR_LOTE
         SET ${sets.join(', ')}
       WHERE ID_POR_LOTE = :id
      `,
      binds,
      { autoCommit: true }
    );

    if ((up.rowsAffected || 0) === 0) {
      return res.status(404).json({ message: 'Lote no encontrado.' });
    }

    // devolver el lote actualizado (con join para código/nombre)
    const rs = await cn.execute(
      `
      SELECT
        ppl.ID_POR_LOTE                          AS "ID",
        ppl.LOTE_ID                              AS "LOTE_ID",
        ppl.PRODUCTO_ID                          AS "PRODUCTO_ID",
        NVL(ppl.CANTIDAD_DISPONIBLE, 0)          AS "CANTIDAD_DISPONIBLE",
        ppl.FECHA_VENCIMIENTO                    AS "FECHA_VENCIMIENTO",
        TO_CHAR(ppl.FECHA_VENCIMIENTO,'DD/MM/YYYY') AS "FECHA_VENCIMIENTO_TX",
        pl.CODIGO_LOTE                           AS "CODIGO_LOTE",
        pl.NOMBRE                                AS "NOMBRE_LOTE"
      FROM ${SCHEMA}POS_PRODUCTO_POR_LOTE ppl
      LEFT JOIN ${SCHEMA}POS_PRODUCTO_LOTE pl
        ON pl.ID = ppl.LOTE_ID
      WHERE ppl.ID_POR_LOTE = :id
      `,
      { id: idPorLote },
      OUT
    );

    const r = rs.rows[0];
    return res.json({
      id: r.ID,
      loteId: r.LOTE_ID,
      loteCodigo: r.CODIGO_LOTE || null,
      loteNombre: r.NOMBRE_LOTE || null,
      productoId: r.PRODUCTO_ID,
      cantidadDisponible: Number(r.CANTIDAD_DISPONIBLE || 0),
      fechaVencimiento: r.FECHA_VENCIMIENTO || null,
      fechaVencimientoTx: r.FECHA_VENCIMIENTO_TX || null,
    });
  } catch (err) {
    console.error('❌ Error actualizarPorLote:', err);
    return res.status(500).json({ message: 'Error al actualizar lote.' });
  } finally {
    if (cn) try { await cn.close(); } catch {}
  }
};
