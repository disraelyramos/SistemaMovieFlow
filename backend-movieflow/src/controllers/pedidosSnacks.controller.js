// backend-movieflow/src/controllers/pedidosSnacks.controller.js
const db = require('../config/db');
const oracledb = require('oracledb');
const { sendPDF } = require('../../utils/pdfHelper'); // ← RUTA CORRECTA
const { buildPedidoSnackDoc } = require('../../pdf/pedidoSnack.doc');

const Q = (s) => s.replace(/\s+/g, ' ').trim();

/* ══════════════════════════════════════════════════════
   Helper: apertura activa (no Taquilla) por usuario
   ══════════════════════════════════════════════════════ */

// ⬇⬇ Reemplaza el helper por este

async function getAperturaActivaNoTaquilla(connection, usuarioId) {
  const OUT = { outFormat: oracledb.OUT_FORMAT_OBJECT };

  // Candidatos de join (con y sin esquema; plural y singular)
  const joins = [
    `FROM ESTUDIANTE.POS_APERTURA_CAJA ac
      JOIN ESTUDIANTE.POS_CAJAS c ON c.ID_CAJA = ac.CAJA_ID`,
    `FROM ESTUDIANTE.POS_APERTURA_CAJA ac
      JOIN ESTUDIANTE.POS_CAJA c ON c.ID_CAJA = ac.CAJA_ID`,
    `FROM POS_APERTURA_CAJA ac
      JOIN POS_CAJAS c ON c.ID_CAJA = ac.CAJA_ID`,
    `FROM POS_APERTURA_CAJA ac
      JOIN POS_CAJA c ON c.ID_CAJA = ac.CAJA_ID`,
  ];

  // Query base (filtro por nombre y estado; usa NOMBRE_CAJA que es tu columna)
  const selectBase = (whereExtra = '') => `
    SELECT ac.ID_APERTURA, ac.CAJA_ID
      /*JOIN_CANDIDATE*/
     WHERE ac.ESTADO_ID = 1
       AND (UPPER(c.NOMBRE_CAJA) NOT LIKE '%TAQUILLA%')
       ${whereExtra}
     ORDER BY ac.FECHA_APERTURA DESC, ac.HORA_APERTURA DESC
     FETCH FIRST 1 ROWS ONLY`;

  // 1) Intento por usuario (si viene)
  if (usuarioId) {
    for (const j of joins) {
      const sql = selectBase(`AND ac.USUARIO_ID = :uid`).replace('/*JOIN_CANDIDATE*/', j);
      try {
        const r = await connection.execute(sql, { uid: usuarioId }, OUT);
        if (r.rows && r.rows[0]) return r.rows[0];
      } catch (e) {
        if (String(e?.code) !== 'ORA-00942') throw e; // error real → propaga
        // si es 00942 seguimos con el siguiente join
      }
    }
  }

  // 2) Fallback: cualquier apertura abierta (no Taquilla)
  for (const j of joins) {
    const sql = selectBase().replace('/*JOIN_CANDIDATE*/', j);
    try {
      const r = await connection.execute(sql, {}, OUT);
      if (r.rows && r.rows[0]) return r.rows[0];
    } catch (e) {
      if (String(e?.code) !== 'ORA-00942') throw e;
    }
  }

  return null;
}

//
// GET /api/pedidos-snacks/funciones-activas
//
exports.listarFuncionesActivasAhora = async (_req, res) => {
  let connection;
  try {
    connection = await db.getConnection();

    const sql = Q(`
      SELECT
        ID_FUNCION  AS "id",
        SALA_ID     AS "salaId",
        /* mapa de ids a nombre comercial */
        CASE 
          WHEN SALA_ID = 9 THEN 'A'
          ELSE TO_CHAR(SALA_ID)
        END         AS "salaNombre",
        FECHA       AS "fecha",
        HORA_INICIO AS "horaInicio",
        HORA_FINAL  AS "horaFinal"
      FROM ESTUDIANTE.V_FUNCIONES_ACTIVAS_NOW
      ORDER BY FECHA, SALA_ID
    `);

    const r = await connection.execute(sql, {}, { outFormat: oracledb.OUT_FORMAT_OBJECT });
    return res.json(r.rows);
  } catch (e) {
    console.error('[listarFuncionesActivasAhora]', e);
    return res.status(500).json({ message: 'Error al listar funciones activas' });
  } finally {
    try { await connection?.close(); } catch (_) {}
  }
};


// ====== LISTADO DE PRODUCTOS (CATÁLOGO PARA SNACKS) ======
exports.listarProductos = async (_req, res) => {
  let connection;
  try {
    connection = await db.getConnection();
    const r = await connection.execute(
      `
      SELECT 
        p.ID,
        p.NOMBRE,
        p.PRECIO_VENTA,
        p.IMAGEN_URL
      FROM POS_PRODUCTO_NUEVO p
      ORDER BY p.NOMBRE
      `,
      {},
      { outFormat: oracledb.OUT_FORMAT_OBJECT }
    );

    const rows = r.rows.map(row => ({
      id: row.ID,
      nombre: row.NOMBRE,
      precio_venta: Number(row.PRECIO_VENTA || 0),
      imagen_url: row.IMAGEN_URL || null,
    }));

    res.json(rows);
  } catch (e) {
    console.error('[listarProductos]', e);
    res.status(500).json({ message: 'Error al listar productos' });
  } finally { try { await connection?.close(); } catch {} }
};

// ====== LISTADO DE COMBOS (CATÁLOGO PARA SNACKS) ======
exports.listarCombos = async (_req, res) => {
  let connection;
  try {
    connection = await db.getConnection();
    const r = await connection.execute(
      `
      SELECT 
        c.ID,
        c.NOMBRE,
        c.PRECIO_VENTA,
        NULL AS IMAGEN_URL
      FROM POS_COMBO c
      ORDER BY c.NOMBRE
      `,
      {},
      { outFormat: oracledb.OUT_FORMAT_OBJECT }
    );

    const rows = r.rows.map(row => ({
      id: row.ID,
      nombre: row.NOMBRE,
      precio_venta: Number(row.PRECIO_VENTA || 0),
      imagen_url: row.IMAGEN_URL || null,
    }));

    res.json(rows);
  } catch (e) {
    console.error('[listarCombos]', e);
    res.status(500).json({ message: 'Error al listar combos' });
  } finally { try { await connection?.close(); } catch {} }
};

//
// POST /api/pedidos-snacks
// body: { clienteId?, clienteNombre, funcionId, salaId, asientoCod, items:[{tipo:'PRODUCTO'|'COMBO', id, cantidad, descripcion?, precio?}], totalGtq, efectivoGtq }
//
exports.crearPedido = async (req, res) => {
  let connection;
  try {
    const b = req.body || {};
    const toNum = (v) => (v === null || v === undefined || v === '' ? NaN : Number(v));

    const funcionId   = toNum(b.funcionId);
    const salaId      = toNum(b.salaId);
    const totalGtq    = toNum(b.totalGtq);
    const efectivoGtq = toNum(b.efectivoGtq);
    const asientoCod  = String(b.asientoCod || '').trim().toUpperCase();

    if (
      !b.clienteNombre ||
      !asientoCod ||
      !Array.isArray(b.items) || b.items.length === 0 ||
      [funcionId, salaId, totalGtq, efectivoGtq].some((x) => Number.isNaN(x))
    ) {
      return res.status(400).json({
        code: 'BAD_REQUEST',
        message: 'Datos incompletos/incorrectos del pedido',
        detalle: { funcionId, salaId, totalGtq, efectivoGtq, itemsLen: Array.isArray(b.items) ? b.items.length : 0 }
      });
    }

    connection = await db.getConnection();

    // 1) Validar que la función está activa
    const fun = await connection.execute(
      Q(`SELECT 1 FROM V_FUNCIONES_ACTIVAS_NOW WHERE ID_FUNCION = :p_id`),
      { p_id: funcionId }
    );
    if (fun.rows.length === 0) {
      return res.status(400).json({ code: 'FUNCION_NO_ACTIVA', message: 'La función no está activa en este momento' });
    }

    // ====== VALIDACIONES DE BUTACA ======
    const m = asientoCod.match(/^([A-ZÑ]{1,3})(\d{1,3})$/); // FILA + NUM
    const filaTx = m ? m[1] : null;
    const colTx  = m ? Number(m[2]) : NaN;

    const rAsiento = await connection.execute(
      Q(`
        SELECT ID_ASIENTO, ACTIVO
        FROM ASIENTOS
        WHERE ID_SALA = :p_sala
          AND (
            UPPER(CODIGO) = :p_cod
            OR (UPPER(FILA) = :p_fila AND COLUMNA = :p_col)
          )
      `),
      { p_sala: salaId, p_cod: asientoCod, p_fila: filaTx, p_col: colTx },
      { outFormat: oracledb.OUT_FORMAT_OBJECT }
    );

    if (rAsiento.rows.length === 0) {
      return res.status(400).json({ code: 'BUTACA_NO_EXISTE', message: 'La butaca no existe en la sala seleccionada.' });
    }
    const AS = rAsiento.rows[0];
    if (String(AS.ACTIVO).toUpperCase() !== 'S') {
      return res.status(400).json({ code: 'BUTACA_INACTIVA', message: 'La butaca está deshabilitada en esta sala.' });
    }

    const asientoId = AS.ID_ASIENTO;

    // b) Estado de la butaca para la función
    const rFA = await connection.execute(
      Q(`
        SELECT ID_FA, ESTADO, BLOQUEADO_HASTA
        FROM FUNCION_ASIENTO
        WHERE ID_FUNCION = :p_f
          AND ID_ASIENTO  = :p_a
      `),
      { p_f: funcionId, p_a: asientoId },
      { outFormat: oracledb.OUT_FORMAT_OBJECT }
    );

    let fa = rFA.rows[0] || null;
    const estadoFa = fa?.ESTADO ? String(fa.ESTADO).toUpperCase() : 'DISPONIBLE';

    if (estadoFa === 'BLOQUEADO') {
      if (!fa?.BLOQUEADO_HASTA || new Date(fa.BLOQUEADO_HASTA) > new Date()) {
        return res.status(400).json({ code: 'BUTACA_BLOQUEADA', message: 'La butaca está temporalmente bloqueada.' });
      }
    }

    // c) Exigir compra previa (entrada)
    if (!fa) {
      return res.status(400).json({ code: 'SIN_COMPRA_PREVIA', message: 'No existe una compra previa en la butaca.' });
    }
    const rEntrada = await connection.execute(
      Q(`
        SELECT 1
        FROM ENTRADAS
        WHERE ID_FA = :p_fa
          AND UPPER(NVL(ESTADO,'OK')) NOT IN ('ANULADA','CANCELADA')
        FETCH FIRST 1 ROWS ONLY
      `),
      { p_fa: fa.ID_FA }
    );
    if (rEntrada.rows.length === 0) {
      return res.status(400).json({ code: 'SIN_COMPRA_PREVIA', message: 'No existe una compra previa en la butaca.' });
    }
    // ====== /VALIDACIONES DE BUTACA ======

    // ---- insertar cabecera ----
    const rCab = await connection.execute(
      Q(`
        INSERT INTO POS_PEDIDO_SNACK
        (CLIENTE_ID, CLIENTE_NOMBRE, FUNCION_ID, SALA_ID, ASIENTO_COD, TOTAL_GTQ, EFECTIVO_GTQ)
        VALUES (:p_cliente_id, :p_cliente_nombre, :p_funcion_id, :p_sala_id, :p_asiento, :p_total, :p_efectivo)
        RETURNING ID_PEDIDO, CAMBIO_GTQ INTO :p_id_out, :p_cambio_out
      `),
      {
        p_cliente_id: b.clienteId ?? null,
        p_cliente_nombre: String(b.clienteNombre),
        p_funcion_id: funcionId,
        p_sala_id: salaId,
        p_asiento: asientoCod,
        p_total: Number(totalGtq.toFixed(2)),
        p_efectivo: Number(efectivoGtq.toFixed(2)),
        p_id_out: { dir: oracledb.BIND_OUT, type: oracledb.NUMBER },
        p_cambio_out: { dir: oracledb.BIND_OUT, type: oracledb.NUMBER },
      },
      { autoCommit: false }
    );

    const idPedido = rCab.outBinds.p_id_out[0];

    // ---- insertar detalle (snapshot en SQL, robusto) ----
    for (const it of b.items) {
      const tipo = String(it.tipo || '').toUpperCase(); // PRODUCTO | COMBO
      if (!['PRODUCTO', 'COMBO'].includes(tipo)) throw new Error('Tipo de item inválido');

      const itemId   = toNum(it.id);
      const cantidad = toNum(it.cantidad) || 1;
      if (Number.isNaN(itemId) || Number.isNaN(cantidad)) {
        throw new Error('Item sin id o cantidad numérica');
      }

      const rDet = await connection.execute(
        Q(`
          INSERT INTO POS_PEDIDO_SNACK_DET
          (ID_PEDIDO, ITEM_TIPO, ITEM_ID, DESCRIPCION, PRECIO_UNIT_GTQ, CANTIDAD, SUBTOTAL_GTQ)
          SELECT
            :p_pedido_id,
            :p_tipo,
            :p_item_id,
            CASE
              WHEN :p_tipo = 'PRODUCTO'
                THEN (SELECT p.NOMBRE FROM POS_PRODUCTO_NUEVO p WHERE p.ID = :p_item_id)
              ELSE (SELECT c.NOMBRE FROM POS_COMBO c WHERE c.ID = :p_item_id)
            END AS DESCRIPCION,
            CASE
              WHEN :p_tipo = 'PRODUCTO'
                THEN (SELECT NVL(p.PRECIO_VENTA,0) FROM POS_PRODUCTO_NUEVO p WHERE p.ID = :p_item_id)
              ELSE (SELECT NVL(c.PRECIO_VENTA,0) FROM POS_COMBO c WHERE c.ID = :p_item_id)
            END AS PRECIO_UNIT_GTQ,
            :p_cantidad AS CANTIDAD,
            (
              CASE
                WHEN :p_tipo = 'PRODUCTO'
                  THEN (SELECT NVL(p.PRECIO_VENTA,0) FROM POS_PRODUCTO_NUEVO p WHERE p.ID = :p_item_id)
                ELSE (SELECT NVL(c.PRECIO_VENTA,0) FROM POS_COMBO c WHERE c.ID = :p_item_id)
              END
            ) * :p_cantidad AS SUBTOTAL_GTQ
          FROM DUAL
        `),
        {
          p_pedido_id: idPedido,
          p_tipo: tipo,
          p_item_id: itemId,
          p_cantidad: cantidad,
        },
        { autoCommit: false }
      );

      if (rDet.rowsAffected === 0) {
        throw new Error('No se pudo insertar el detalle del pedido');
      }
    }

    await connection.commit();
    return res.status(201).json({ idPedido });
  } catch (e) {
    try { await connection?.rollback(); } catch {}
    console.error('[crearPedido]', e);
    if (e?.code && e?.message) {
      return res.status(400).json({ code: e.code, message: e.message });
    }
    return res.status(500).json({ code: 'SERVER_ERROR', message: 'Error al crear pedido' });
  } finally {
    try { await connection?.close(); } catch {}
  }
};

//
// GET /api/pedidos-snacks/mis   (usa req.user?.id si existe; si no, puedes enviar header x-user-id)
// ?estado=PENDIENTE|ACEPTADO|ENTREGADO
//
// ====== GET /api/pedidos-snacks/mis ======
exports.listarMisPedidos = async (req, res) => {
  let connection;
  try {
    const userId = req.user?.id ?? (req.headers['x-user-id'] ? Number(req.headers['x-user-id']) : null);
    const estado = String(req.query?.estado || '').toUpperCase();

    const bind = {};
    let where = '1=1';
    if (userId != null && !Number.isNaN(userId)) {
      where += ' AND NVL(CLIENTE_ID, -1) = :p_uid';
      bind.p_uid = userId;
    }
    if (['PENDIENTE','ACEPTADO','ENTREGADO'].includes(estado)) {
      where += ' AND ESTADO = :p_e';
      bind.p_e = estado;
    }

    connection = await db.getConnection();
    const r = await connection.execute(
      Q(`
        SELECT
          ID_PEDIDO                        AS "id",
          CLIENTE_NOMBRE                   AS "clienteNombre",
          FUNCION_ID                       AS "funcionId",
          SALA_ID                          AS "salaId",
          CASE WHEN SALA_ID = 9 THEN 'A' ELSE TO_CHAR(SALA_ID) END AS "salaNombre",
          ASIENTO_COD                      AS "asiento",
          NVL(TOTAL_GTQ,0)                 AS "total",
          NVL(EFECTIVO_GTQ,0)              AS "efectivo",
          NVL(CAMBIO_GTQ,0)                AS "cambio",
          ESTADO                           AS "estado",
          TO_CHAR(CREATED_AT,'YYYY-MM-DD HH24:MI') AS "creado"
        FROM ESTUDIANTE.POS_PEDIDO_SNACK
        WHERE ${where}
        ORDER BY ID_PEDIDO DESC
      `),
      bind,
      { outFormat: oracledb.OUT_FORMAT_OBJECT }
    );

    // Ya viene con las claves correctas
    res.json(r.rows);
  } catch (e) {
    console.error('[listarMisPedidos]', e);
    res.status(500).json({ message: 'Error al listar pedidos' });
  } finally { try { await connection?.close(); } catch (_) {} }
};

// ====== GET /api/pedidos-snacks/por-funcion/:funcionId ======
// ====== GET /api/pedidos-snacks/por-funcion/:funcionId?estado=... ======
exports.listarPorFuncion = async (req, res) => {
  let connection;
  try {
    const funcionId = parseInt(req.params.funcionId, 10);
    if (Number.isNaN(funcionId)) {
      return res.status(400).json({ message: 'Función inválida' });
    }

    const estado = String(req.query?.estado || '').toUpperCase();
    const bind = { p_f: funcionId };
    let where = 'FUNCION_ID = :p_f';

    // Solo filtra si es uno de los estados válidos; "TODOS" no filtra
    if (['PENDIENTE', 'ACEPTADO', 'ENTREGADO'].includes(estado)) {
      where += ' AND ESTADO = :p_e';
      bind.p_e = estado;
    }

    connection = await db.getConnection();
    const r = await connection.execute(
      Q(`
        SELECT
          ID_PEDIDO                        AS "id",
          CLIENTE_NOMBRE                   AS "clienteNombre",
          SALA_ID                          AS "salaId",
          CASE WHEN SALA_ID = 9 THEN 'A' ELSE TO_CHAR(SALA_ID) END AS "salaNombre",
          ASIENTO_COD                      AS "asiento",
          NVL(TOTAL_GTQ,0)                 AS "total",
          NVL(EFECTIVO_GTQ,0)              AS "efectivo",
          NVL(CAMBIO_GTQ,0)                AS "cambio",
          NVL(ESTADO,'PENDIENTE')          AS "estado",
          /* viene como string 'YYYY-MM-DD HH24:MI' para que el front lo parsee */
          TO_CHAR(CREATED_AT,'YYYY-MM-DD HH24:MI') AS "creado"
        FROM ESTUDIANTE.POS_PEDIDO_SNACK
        WHERE ${where}
        ORDER BY ID_PEDIDO DESC
      `),
      bind,
      { outFormat: oracledb.OUT_FORMAT_OBJECT }
    );

    return res.json(r.rows);
  } catch (e) {
    console.error('[listarPorFuncion]', e);
    return res.status(500).json({ message: 'Error al listar por función' });
  } finally {
    try { await connection?.close(); } catch (_) {}
  }
};

//
// PATCH /api/pedidos-snacks/:id/estado   body: { estado: 'ACEPTADO'|'ENTREGADO' }
//
exports.actualizarEstado = async (req, res) => {
  let connection;
  try {
    const id = parseInt(req.params.id, 10);
    const estado = String(req.body?.estado || '').toUpperCase();
    if (Number.isNaN(id) || !['ACEPTADO','ENTREGADO'].includes(estado)) {
      return res.status(400).json({ message: 'Datos inválidos' });
    }

    connection = await db.getConnection();

    // Usuario para validar apertura (usar JWT o header)
    const usuarioId = req.user?.id ?? (req.headers['x-user-id'] ? Number(req.headers['x-user-id']) : null);

    // === ACEPTADO: exigir caja abierta (no taquilla), NO crea venta ===
    if (estado === 'ACEPTADO') {
      const apertura = await getAperturaActivaNoTaquilla(connection, usuarioId);
      if (!apertura) {
        return res.status(409).json({ message: 'Debe tener una caja abierta (no Taquilla) para aceptar pedidos.' });
      }

      const r = await connection.execute(
        Q(`
          UPDATE POS_PEDIDO_SNACK
          SET ESTADO = :p_e
          WHERE ID_PEDIDO = :p_id
        `),
        { p_e: 'ACEPTADO', p_id: id },
        { autoCommit: true }
      );
      if (r.rowsAffected === 0) return res.status(404).json({ message: 'Pedido no encontrado' });
      return res.json({ ok: true });
    }

    // === ENTREGADO: validar caja + descontar stock (+ combos) + registrar venta + marcar ENTREGADO ===
    const apertura = await getAperturaActivaNoTaquilla(connection, usuarioId);
    if (!apertura) {
      return res.status(409).json({ message: 'Debe tener una caja abierta (no Taquilla) para entregar pedidos.' });
    }

    // 0) Cabecera del pedido
    const rCab = await connection.execute(
      Q(`
        SELECT 
          p.ID_PEDIDO, p.CLIENTE_ID, p.CLIENTE_NOMBRE, p.FUNCION_ID, p.SALA_ID, p.ASIENTO_COD,
          NVL(p.TOTAL_GTQ,0) TOTAL_GTQ, NVL(p.EFECTIVO_GTQ,0) EFECTIVO_GTQ, NVL(p.CAMBIO_GTQ,0) CAMBIO_GTQ,
          NVL(p.ESTADO,'PENDIENTE') ESTADO
        FROM POS_PEDIDO_SNACK p
        WHERE p.ID_PEDIDO = :p_id
      `),
      { p_id: id },
      { outFormat: oracledb.OUT_FORMAT_OBJECT }
    );
    if (rCab.rows.length === 0) return res.status(404).json({ message: 'Pedido no encontrado' });

    const PED = rCab.rows[0];
    const estadoActual = String(PED.ESTADO || 'PENDIENTE').toUpperCase();

    // Idempotencia: si ya está ENTREGADO, respondemos ok (no duplicamos)
    if (estadoActual === 'ENTREGADO') {
      return res.json({ ok: true });
    }

    // 1) Detalle del pedido
    const rDet = await connection.execute(
      Q(`
        SELECT 
          d.ITEM_TIPO,
          d.ITEM_ID,
          NVL(d.DESCRIPCION, NULL) AS DESCRIPCION,
          NVL(d.PRECIO_UNIT_GTQ,0) AS PRECIO_UNIT,
          NVL(d.CANTIDAD,0)        AS CANTIDAD,
          NVL(d.SUBTOTAL_GTQ,0)    AS SUBTOTAL
        FROM POS_PEDIDO_SNACK_DET d
        WHERE d.ID_PEDIDO = :p_id
        ORDER BY d.ID_DETALLE
      `),
      { p_id: id },
      { outFormat: oracledb.OUT_FORMAT_OBJECT }
    );
    const det = rDet.rows || [];

    // 2) Evitar duplicidad de venta
    const rExiste = await connection.execute(
      Q(`SELECT 1 FROM POS_VENTA_SNACK_CLI WHERE PEDIDO_ID = :p_id FETCH FIRST 1 ROWS ONLY`),
      { p_id: id }
    );
    const yaExisteVenta = rExiste.rows.length > 0;

    // Helper: consumir stock FIFO por producto
    const consumirFIFO = async (productoId, cantidad) => {
      let porConsumir = Number(cantidad || 0);
      if (!productoId || porConsumir <= 0) return;

      const rLotes = await connection.execute(
        Q(`
          SELECT ID_POR_LOTE, NVL(CANTIDAD_DISPONIBLE,0) AS DISP
          FROM POS_PRODUCTO_POR_LOTE
          WHERE PRODUCTO_ID = :p_pid
            AND NVL(CANTIDAD_DISPONIBLE,0) > 0
          ORDER BY FECHA_INGRESO ASC, ID_POR_LOTE
        `),
        { p_pid: productoId },
        { outFormat: oracledb.OUT_FORMAT_OBJECT }
      );

      for (const L of rLotes.rows) {
        if (porConsumir <= 0) break;
        const disp = Number(L.DISP || 0);
        if (disp <= 0) continue;

        const consume = Math.min(disp, porConsumir);
        const nuevo = disp - consume;

        const rUpd = await connection.execute(
          Q(`
            UPDATE POS_PRODUCTO_POR_LOTE
            SET CANTIDAD_DISPONIBLE = :p_nuevo
            WHERE ID_POR_LOTE = :p_id
          `),
          { p_nuevo: nuevo, p_id: L.ID_POR_LOTE },
          { autoCommit: false }
        );
        if (rUpd.rowsAffected === 0) throw new Error('No se pudo actualizar stock por lote');

        porConsumir -= consume;
      }

      if (porConsumir > 0) {
        throw new Error(`STOCK_INSUFICIENTE: producto ${productoId}, faltante ${porConsumir}`);
      }
    };

    // 3) Construir requerimiento total por PRODUCTO (productos directos + combos)
    const requeridos = new Map();

    // 3a) Agregar productos directos
    for (const d of det) {
      if (String(d.ITEM_TIPO || '').toUpperCase() !== 'PRODUCTO') continue;
      const pid = Number(d.ITEM_ID);
      const cant = Number(d.CANTIDAD || 0);
      if (!pid || cant <= 0) continue;
      requeridos.set(pid, (requeridos.get(pid) || 0) + cant);
    }

    // 3b) Expandir combos por sus componentes (POS_DETALLE_COMBO)
    for (const d of det) {
      if (String(d.ITEM_TIPO || '').toUpperCase() !== 'COMBO') continue;
      const comboId = Number(d.ITEM_ID);
      const qtyCombos = Number(d.CANTIDAD || 0);
      if (!comboId || qtyCombos <= 0) continue;

      const rComp = await connection.execute(
        Q(`
          SELECT PRODUCTO_ID, NVL(CANTIDAD,0) AS CANTIDAD
          FROM POS_DETALLE_COMBO
          WHERE COMBO_ID = :p_cid
        `),
        { p_cid: comboId },
        { outFormat: oracledb.OUT_FORMAT_OBJECT }
      );

      for (const c of rComp.rows) {
        const pid = Number(c.PRODUCTO_ID);
        const cant = Number(c.CANTIDAD || 0) * qtyCombos;
        if (!pid || cant <= 0) continue;
        requeridos.set(pid, (requeridos.get(pid) || 0) + cant);
      }
    }

    // 4) Descontar stock por producto (FIFO) si aún no existe la venta
    if (!yaExisteVenta) {
      for (const [pid, cant] of requeridos.entries()) {
        await consumirFIFO(pid, cant);
      }
    }

    // 5) Insertar venta (cabecera + detalle) si aún no existe
    let ventaId = null;
    if (!yaExisteVenta) {
      // Intento 1: insertar asociando APERTURA/CAJA (si esas columnas existen)
      try {
        const rInsCab = await connection.execute(
          Q(`
            INSERT INTO POS_VENTA_SNACK_CLI
            (PEDIDO_ID, CLIENTE_ID, CLIENTE_NOMBRE, FUNCION_ID, SALA_ID, ASIENTO_COD,
             TOTAL_GTQ, EFECTIVO_GTQ, CAMBIO_GTQ, APERTURA_ID, CAJA_ID)
            VALUES
            (:p_pid, :p_cli_id, :p_cli_nom, :p_fun, :p_sala, :p_asiento,
             :p_tot, :p_efe, :p_cam, :p_aper, :p_caja)
            RETURNING ID_VENTA INTO :p_out
          `),
          {
            p_pid: PED.ID_PEDIDO,
            p_cli_id: PED.CLIENTE_ID ?? null,
            p_cli_nom: PED.CLIENTE_NOMBRE,
            p_fun: PED.FUNCION_ID,
            p_sala: PED.SALA_ID,
            p_asiento: PED.ASIENTO_COD,
            p_tot: Number(PED.TOTAL_GTQ || 0),
            p_efe: Number(PED.EFECTIVO_GTQ || 0),
            p_cam: Number(PED.CAMBIO_GTQ || 0),
            p_aper: apertura.ID_APERTURA,
            p_caja: apertura.CAJA_ID,
            p_out: { dir: oracledb.BIND_OUT, type: oracledb.NUMBER },
          },
          { autoCommit: false }
        );
        ventaId = rInsCab.outBinds.p_out[0];
      } catch (errInsertConCaja) {
        // Si la tabla no tiene las columnas, caemos al insert original (sin romper nada)
        const rInsCab = await connection.execute(
          Q(`
            INSERT INTO POS_VENTA_SNACK_CLI
            (PEDIDO_ID, CLIENTE_NOMBRE, FUNCION_ID, SALA_ID, ASIENTO_COD,
             TOTAL_GTQ, EFECTIVO_GTQ, CAMBIO_GTQ)
            VALUES
            (:p_pid, :p_cli, :p_fun, :p_sala, :p_asiento, :p_tot, :p_efe, :p_cam)
            RETURNING ID_VENTA INTO :p_out
          `),
          {
            p_pid: PED.ID_PEDIDO,
            p_cli: PED.CLIENTE_NOMBRE,
            p_fun: PED.FUNCION_ID,
            p_sala: PED.SALA_ID,
            p_asiento: PED.ASIENTO_COD,
            p_tot: Number(PED.TOTAL_GTQ || 0),
            p_efe: Number(PED.EFECTIVO_GTQ || 0),
            p_cam: Number(PED.CAMBIO_GTQ || 0),
            p_out: { dir: oracledb.BIND_OUT, type: oracledb.NUMBER },
          },
          { autoCommit: false }
        );
        ventaId = rInsCab.outBinds.p_out[0];
      }

      for (const d of det) {
        await connection.execute(
          Q(`
            INSERT INTO POS_VENTA_SNACK_CLI_DET
            (VENTA_ID, ITEM_TIPO, ITEM_ID, DESCRIPCION, PRECIO_UNIT_GTQ, CANTIDAD, SUBTOTAL_GTQ)
            VALUES
            (:p_vid, :p_tipo, :p_item, :p_desc, :p_precio, :p_cant, :p_subt)
          `),
          {
            p_vid: ventaId,
            p_tipo: d.ITEM_TIPO,
            p_item: d.ITEM_ID,
            p_desc: d.DESCRIPCION,
            p_precio: Number(d.PRECIO_UNIT || 0),
            p_cant: Number(d.CANTIDAD || 0),
            p_subt: Number(d.SUBTOTAL || 0),
          },
          { autoCommit: false }
        );
      }
    }

    // 6) Marcar ENTREGADO
    const rUpdPed = await connection.execute(
      Q(`
        UPDATE POS_PEDIDO_SNACK
        SET ESTADO = :p_e
        WHERE ID_PEDIDO = :p_id
      `),
      { p_e: 'ENTREGADO', p_id: id },
      { autoCommit: false }
    );
    if (rUpdPed.rowsAffected === 0) throw new Error('No se pudo actualizar estado del pedido');

    await connection.commit();
    return res.json({ ok: true });
  } catch (e) {
    try { await connection?.rollback(); } catch {}
    console.error('[actualizarEstado]', e);
    res.status(500).json({ message: e?.message || 'Error al actualizar estado' });
  } finally {
    try { await connection?.close(); } catch (_) {}
  }
};

//
// ====== PDF: GET /api/pedidos-snacks/:id/pdf ======
exports.generarComprobantePDF = async (req, res) => {
  let connection;
  try {
    const id = parseInt(req.params.id, 10);
    if (Number.isNaN(id)) return res.status(400).json({ message: 'ID inválido' });

    connection = await db.getConnection();

    // --- CABECERA (con nombres y formateo) ---
    const cab = await connection.execute(
      Q(`
        SELECT 
          ID_PEDIDO,
          CLIENTE_NOMBRE,
          FUNCION_ID,
          SALA_ID,
          CASE WHEN SALA_ID = 9 THEN 'A' ELSE TO_CHAR(SALA_ID) END AS SALA_NOMBRE,
          ASIENTO_COD,
          NVL(TOTAL_GTQ,0)    AS TOTAL_GTQ,
          NVL(EFECTIVO_GTQ,0) AS EFECTIVO_GTQ,
          NVL(CAMBIO_GTQ,0)   AS CAMBIO_GTQ,
          ESTADO,
          TO_CHAR(CREATED_AT, 'YYYY-MM-DD HH24:MI') AS CREADO_STR
        FROM ESTUDIANTE.POS_PEDIDO_SNACK
        WHERE ID_PEDIDO = :p_id
      `),
      { p_id: id },
      { outFormat: oracledb.OUT_FORMAT_OBJECT }
    );

    if (cab.rows.length === 0) return res.status(404).json({ message: 'Pedido no encontrado' });
    const H = cab.rows[0];

    // --- DETALLE (JOINs por tipo, con alias estables) ---
    const det = await connection.execute(
      Q(`
        SELECT 
          d.ITEM_TIPO,
          d.ITEM_ID,
          NVL(d.DESCRIPCION, NVL(p.NOMBRE, c.NOMBRE))                                 AS DESCRIPCION_RES,
          NVL(d.PRECIO_UNIT_GTQ, NVL(p.PRECIO_VENTA, c.PRECIO_VENTA))                  AS PRECIO_UNIT_RES,
          NVL(d.CANTIDAD, 0)                                                           AS CANTIDAD_RES,
          NVL(
            d.SUBTOTAL_GTQ,
            NVL(d.PRECIO_UNIT_GTQ, NVL(p.PRECIO_VENTA, c.PRECIO_VENTA)) * NVL(d.CANTIDAD, 0)
          )                                                                            AS SUBTOTAL_RES
        FROM ESTUDIANTE.POS_PEDIDO_SNACK_DET d
        LEFT JOIN ESTUDIANTE.POS_PRODUCTO_NUEVO p
          ON (UPPER(TRIM(d.ITEM_TIPO)) = 'PRODUCTO' AND p.ID = d.ITEM_ID)
        LEFT JOIN ESTUDIANTE.POS_COMBO c
          ON (UPPER(TRIM(d.ITEM_TIPO)) = 'COMBO' AND c.ID = d.ITEM_ID)
        WHERE d.ID_PEDIDO = :p_id
        ORDER BY d.ID_DETALLE
      `),
      { p_id: id },
      { outFormat: oracledb.OUT_FORMAT_OBJECT }
    );

    const detalles = det.rows.map((d, idx) => {
      const nombre   = d.DESCRIPCION_RES || '';
      const precio   = Number(d.PRECIO_UNIT_RES || 0);
      const cantidad = Number(d.CANTIDAD_RES || 0);
      const subtotal = Number(d.SUBTOTAL_RES || 0);

      return {
        nro: idx + 1,
        tipo: d.ITEM_TIPO,
        itemId: d.ITEM_ID,
        descripcion: nombre,           // <- lo que imprime el PDF
        precio, cantidad, subtotal,
        // alias por si la plantilla cambia
        desc: nombre, precioUnit: precio, qty: cantidad, importe: subtotal,
      };
    });

    const docDef = buildPedidoSnackDoc({
      id: H.ID_PEDIDO,
      clienteNombre: H.CLIENTE_NOMBRE || '',
      funcionId: H.FUNCION_ID,
      salaId: H.SALA_ID,
      salaNombre: H.SALA_NOMBRE,           // 👈 Sala A cuando sea 9
      asiento: H.ASIENTO_COD || '',
      total: Number(H.TOTAL_GTQ || 0),
      efectivo: Number(H.EFECTIVO_GTQ || 0),
      cambio: Number(H.CAMBIO_GTQ || 0),
      estado: H.ESTADO || '',
      creado: H.CREADO_STR,
      detalles
    });

    return sendPDF(res, docDef, `PedidoSnack_${id}.pdf`);
  } catch (e) {
    console.error('[generarComprobantePDF]', e);
    res.status(500).json({ message: 'Error al generar comprobante' });
  } finally { try { await connection?.close(); } catch (_) {} }
};

// ====== GET /api/pedidos-snacks/ventas-resumen?scope=dia|semana|mes ======
// ====== GET /api/pedidos-snacks/ventas-resumen?scope=dia|semana|mes ======
exports.resumenVentas = async (req, res) => {
  const scope = String(req.query?.scope || 'mes').toLowerCase();
  let connection;

  // helpers de fechas (construimos también objetos Date para armar la serie completa)
  const now = new Date();
  const y = now.getFullYear(), m = now.getMonth() + 1, d = now.getDate();
  const pad2 = (n) => String(n).padStart(2, '0');
  const toStr = (Y, M, D, h = '00', i = '00', s = '00') => `${Y}-${pad2(M)}-${pad2(D)} ${h}:${i}:${s}`;
  const ymd = (dt) => `${dt.getFullYear()}-${pad2(dt.getMonth() + 1)}-${pad2(dt.getDate())}`;

  // rango por scope (mismo criterio que ya usabas: BETWEEN con fin 23:59:59)
  let desdeStr, hastaStr, desdeDate, hastaDate;
  if (scope === 'dia') {
    desdeStr = toStr(y, m, d, '00', '00', '00');
    hastaStr = toStr(y, m, d, '23', '59', '59');
    desdeDate = new Date(y, m - 1, d);
    hastaDate = new Date(y, m - 1, d);
  } else if (scope === 'semana') {
    const s = new Date(now); s.setDate(now.getDate() - 6);
    const y2 = s.getFullYear(), m2 = s.getMonth() + 1, d2 = s.getDate();
    desdeStr = toStr(y2, m2, d2, '00', '00', '00');
    hastaStr = toStr(y, m, d, '23', '59', '59');
    desdeDate = new Date(y2, m2 - 1, d2);
    hastaDate = new Date(y, m - 1, d);
  } else { // mes
    const last = new Date(y, m, 0).getDate();
    desdeStr = toStr(y, m, 1, '00', '00', '00');
    hastaStr = toStr(y, m, last, '23', '59', '59');
    desdeDate = new Date(y, m - 1, 1);
    hastaDate = new Date(y, m - 1, last);
  }

  // 4 fuentes (idénticas a las del reporte de snacks)
  const SQL_SERIE_CAJA_SNACKS = `
    SELECT TO_CHAR(v.FECHA,'YYYY-MM-DD') AS FECHA, NVL(SUM(d.SUBTOTAL_LINEA),0) AS TOTAL
    FROM ESTUDIANTE.POS_VENTAS v
    JOIN ESTUDIANTE.POS_DETALLE_VENTA d ON d.ID_VENTA = v.ID_VENTA
    WHERE v.FECHA BETWEEN TO_DATE(:d,'YYYY-MM-DD HH24:MI:SS')
                      AND TO_DATE(:h,'YYYY-MM-DD HH24:MI:SS')
    GROUP BY TO_CHAR(v.FECHA,'YYYY-MM-DD')
  `;
  const SQL_SERIE_CAJA_COMBOS = `
    SELECT TO_CHAR(v.FECHA,'YYYY-MM-DD') AS FECHA, NVL(SUM(c.SUBTOTAL_LINEA),0) AS TOTAL
    FROM ESTUDIANTE.POS_VENTAS v
    JOIN ESTUDIANTE.POS_VENTA_COMBO c ON c.ID_VENTA = v.ID_VENTA
    WHERE v.FECHA BETWEEN TO_DATE(:d,'YYYY-MM-DD HH24:MI:SS')
                      AND TO_DATE(:h,'YYYY-MM-DD HH24:MI:SS')
    GROUP BY TO_CHAR(v.FECHA,'YYYY-MM-DD')
  `;
  const SQL_SERIE_CLI_SNACKS = `
    SELECT TO_CHAR(v.CREATED_AT,'YYYY-MM-DD') AS FECHA, NVL(SUM(d.SUBTOTAL_GTQ),0) AS TOTAL
    FROM ESTUDIANTE.POS_VENTA_SNACK_CLI v
    JOIN ESTUDIANTE.POS_VENTA_SNACK_CLI_DET d ON d.VENTA_ID = v.ID_VENTA
    WHERE v.CREATED_AT BETWEEN TO_DATE(:d,'YYYY-MM-DD HH24:MI:SS')
                           AND TO_DATE(:h,'YYYY-MM-DD HH24:MI:SS')
      AND d.ITEM_TIPO = 'PRODUCTO'
    GROUP BY TO_CHAR(v.CREATED_AT,'YYYY-MM-DD')
  `;
  const SQL_SERIE_CLI_COMBOS = `
    SELECT TO_CHAR(v.CREATED_AT,'YYYY-MM-DD') AS FECHA, NVL(SUM(d.SUBTOTAL_GTQ),0) AS TOTAL
    FROM ESTUDIANTE.POS_VENTA_SNACK_CLI v
    JOIN ESTUDIANTE.POS_VENTA_SNACK_CLI_DET d ON d.VENTA_ID = v.ID_VENTA
    WHERE v.CREATED_AT BETWEEN TO_DATE(:d,'YYYY-MM-DD HH24:MI:SS')
                           AND TO_DATE(:h,'YYYY-MM-DD HH24:MI:SS')
      AND d.ITEM_TIPO = 'COMBO'
    GROUP BY TO_CHAR(v.CREATED_AT,'YYYY-MM-DD')
  `;

  // (sin cambiar tu "top" actual; puede quedarse solo con canal cliente)
    // Top de items por ingreso (caja snacks + caja combos + cliente)
  const SQL_TOP = `
    WITH X AS (
      /* Caja: productos sueltos */
      SELECT NVL(p.NOMBRE, '(Producto)') AS NOMBRE,
             SUM(NVL(d.CANTIDAD,0))      AS QTY,
             SUM(NVL(d.SUBTOTAL_LINEA,0)) AS TOTAL
      FROM ESTUDIANTE.POS_VENTAS v
      JOIN ESTUDIANTE.POS_DETALLE_VENTA d ON d.ID_VENTA = v.ID_VENTA
      LEFT JOIN ESTUDIANTE.POS_PRODUCTO_NUEVO p ON p.ID = d.PRODUCTO_ID
      WHERE v.FECHA BETWEEN TO_DATE(:d,'YYYY-MM-DD HH24:MI:SS')
                        AND TO_DATE(:h,'YYYY-MM-DD HH24:MI:SS')
      GROUP BY NVL(p.NOMBRE, '(Producto)')

      UNION ALL
      /* Caja: combos */
      SELECT NVL(c.NOMBRE, '(Combo)')    AS NOMBRE,
             SUM(NVL(vc.CANTIDAD,0))     AS QTY,
             SUM(NVL(vc.SUBTOTAL_LINEA,0)) AS TOTAL
      FROM ESTUDIANTE.POS_VENTAS v
      JOIN ESTUDIANTE.POS_VENTA_COMBO vc ON vc.ID_VENTA = v.ID_VENTA
      LEFT JOIN ESTUDIANTE.POS_COMBO c    ON c.ID = vc.COMBO_ID
      WHERE v.FECHA BETWEEN TO_DATE(:d,'YYYY-MM-DD HH24:MI:SS')
                        AND TO_DATE(:h,'YYYY-MM-DD HH24:MI:SS')
      GROUP BY NVL(c.NOMBRE, '(Combo)')

      UNION ALL
      /* Canal cliente: productos y combos, usamos la descripción de la línea */
      SELECT NVL(d.DESCRIPCION,'(Ítem)') AS NOMBRE,
             SUM(NVL(d.CANTIDAD,0))      AS QTY,
             SUM(NVL(d.SUBTOTAL_GTQ,0))  AS TOTAL
      FROM ESTUDIANTE.POS_VENTA_SNACK_CLI v
      JOIN ESTUDIANTE.POS_VENTA_SNACK_CLI_DET d ON d.VENTA_ID = v.ID_VENTA
      WHERE v.CREATED_AT BETWEEN TO_DATE(:d,'YYYY-MM-DD HH24:MI:SS')
                             AND TO_DATE(:h,'YYYY-MM-DD HH24:MI:SS')
      GROUP BY NVL(d.DESCRIPCION,'(Ítem)')
    )
    SELECT NOMBRE,
           SUM(QTY)   AS QTY,
           SUM(TOTAL) AS TOTAL
    FROM X
    GROUP BY NOMBRE
    ORDER BY TOTAL DESC
    FETCH FIRST 8 ROWS ONLY
  `;
  try {
    connection = await db.getConnection();
    const binds = { d: desdeStr, h: hastaStr };
    const OUT = { outFormat: oracledb.OUT_FORMAT_OBJECT };

    // Ejecutar en paralelo
    const [r1, r2, r3, r4, rTop] = await Promise.all([
      connection.execute(SQL_SERIE_CAJA_SNACKS, binds, OUT),
      connection.execute(SQL_SERIE_CAJA_COMBOS, binds, OUT),
      connection.execute(SQL_SERIE_CLI_SNACKS,  binds, OUT),
      connection.execute(SQL_SERIE_CLI_COMBOS,  binds, OUT),
      connection.execute(SQL_TOP,               binds, OUT),
    ]);

    // Unir las 4 series por fecha
    const sumByDay = new Map();
    const addRows = (rows) => {
      (rows || []).forEach(r => {
        const k = r.FECHA;
        const val = Number(r.TOTAL || 0);
        sumByDay.set(k, (sumByDay.get(k) || 0) + val);
      });
    };
    addRows(r1.rows);
    addRows(r2.rows);
    addRows(r3.rows);
    addRows(r4.rows);

    // Construir serie completa con ceros para días sin ventas
    const serie = [];
    const cursor = new Date(desdeDate);
    while (cursor <= hastaDate) {
      const k = ymd(cursor);
      serie.push({ fecha: k, total: Number(sumByDay.get(k) || 0) });
      cursor.setDate(cursor.getDate() + 1);
    }

    const top = (rTop.rows || []).map(r => ({
      nombre: r.NOMBRE,
      qty:    Number(r.QTY || 0),
      total:  Number(r.TOTAL || 0),
    }));


    return res.json({ scope, serie, top });
  } catch (e) {
    console.error('[resumenVentas]', e);
    return res.status(500).json({ message: 'Error al obtener resumen de snacks' });
  } finally {
    try { await connection?.close(); } catch {}
  }
};
