// src/controllers/ventas/corteCaja.controller.js
const db = require("../../config/db");
const oracledb = require("oracledb");

/* ───────────────────── Helpers de fecha (LOCAL) ───────────────────── */
function pad2(n) { return String(n).padStart(2, "0"); }
function isoDate(d) { return `${d.getFullYear()}-${pad2(d.getMonth() + 1)}-${pad2(d.getDate())}`; }
function atStart(d) { const x = new Date(d); x.setHours(0,0,0,0); return x; }
function atEnd(d)   { const x = new Date(d); x.setHours(23,59,59,999); return x; }

function startOfToday()  { return atStart(new Date()); }
function endOfToday()    { return atEnd(new Date()); }
function startOfWeek() {
  const d = new Date();
  const day = d.getDay();                 // 0=Dom
  const diff = (day === 0 ? -6 : 1 - day); // lunes como inicio
  d.setDate(d.getDate() + diff);
  return atStart(d);
}
function endOfWeek()     { const s = startOfWeek(); const e = new Date(s); e.setDate(s.getDate()+6); return atEnd(e); }
function startOfMonth()  { const d = new Date(); d.setDate(1); return atStart(d); }
function endOfMonth()    { const d = new Date(); d.setMonth(d.getMonth()+1, 0); return atEnd(d); }

/* ───────────────────── Filtros para el front ───────────────────── */
exports.obtenerFiltros = async (req, res) => {
  let cn;

  const rangos = [
    { value: "hoy",          label: "Hoy" },
    { value: "semana",       label: "Esta Semana" },
    { value: "mes",          label: "Este Mes" },
    { value: "personalizado",label: "Personalizado" },
  ];

  // ➕ se agregan Boletos y Eventos
  const tipos = [
    { value: "productos", label: "Solo Productos" },
    { value: "combos",    label: "Solo Combos" },
    { value: "boletos",   label: "Solo Boletos" },
    { value: "eventos",   label: "Solo Eventos" },
    { value: "todos",     label: "Todos" },
  ];

  let cajas = [], roles = [], vendedores = [];

  try {
    cn = await db.getConnection();

    // Cajas visibles (de POS)
    try {
      const rsCajas = await cn.execute(
        `SELECT DISTINCT CAJA_ID AS ID
           FROM pos_ventas
          WHERE CAJA_ID IS NOT NULL
          ORDER BY CAJA_ID`,
        [], { outFormat: oracledb.OUT_FORMAT_OBJECT }
      );
      cajas = (rsCajas.rows || []).map(r => ({ id: Number(r.ID), nombre: `Caja ${Number(r.ID)}` }));
    } catch (e) {
      console.warn("ℹ️ obtenerFiltros: cajas no disponibles:", e.message);
    }

    // Roles con actividad
    try {
      const rsRoles = await cn.execute(
        `SELECT DISTINCT r.ID, r.NOMBRE
           FROM pos_ventas v
           JOIN usuarios u ON u.ID = v.USUARIO_ID
           LEFT JOIN roles r ON r.ID = u.ROLE_ID
          WHERE NVL(u.ESTADO,1) = 1
          ORDER BY r.NOMBRE NULLS LAST`,
        [], { outFormat: oracledb.OUT_FORMAT_OBJECT }
      );
      roles = (rsRoles.rows || []).filter(r => r.ID != null).map(r => ({ id: Number(r.ID), nombre: r.NOMBRE }));
    } catch (e) {
      console.warn("ℹ️ obtenerFiltros: roles no disponibles:", e.message);
    }

    // Vendedores (filtrable por role_id)
    try {
      const roleId = Number(req.query.role_id) || null;
      const vendSql = `
        SELECT DISTINCT u.ID, u.NOMBRE
          FROM pos_ventas v
          JOIN usuarios u ON u.ID = v.USUARIO_ID
         WHERE NVL(u.ESTADO,1) = 1
           ${roleId ? "AND u.ROLE_ID = :roleId" : ""}
         ORDER BY u.NOMBRE
      `;
      const rsVend = await cn.execute(
        vendSql,
        roleId ? { roleId } : {},
        { outFormat: oracledb.OUT_FORMAT_OBJECT }
      );
      vendedores = (rsVend.rows || []).map(r => ({ id: Number(r.ID), nombre: r.NOMBRE }));
    } catch (e) {
      console.warn("ℹ️ obtenerFiltros: vendedores no disponibles:", e.message);
    }

    return res.status(200).json({ rangos, cajas, roles, vendedores, tipos });

  } catch (err) {
    console.error("❌ Error global obtenerFiltros:", err);
    return res.status(200).json({ rangos, cajas, roles, vendedores, tipos });
  } finally {
    if (cn) try { await cn.close(); } catch {}
  }
};

/* ───────────────────── Rangos auxiliares ───────────────────── */
exports.obtenerRangosFecha = async (_req, res) => {
  try {
    const anchor = startOfToday();

    const hoyIni = atStart(anchor), hoyFin = endOfToday();
    const ay = new Date(anchor); ay.setDate(anchor.getDate() - 1);
    const ayerIni = atStart(ay), ayerFin = atEnd(ay);

    const dow = anchor.getDay();
    const diff = (dow === 0 ? -6 : 1 - dow);
    const wkStart = new Date(anchor); wkStart.setDate(anchor.getDate() + diff);
    const wkEnd = new Date(wkStart); wkEnd.setDate(wkStart.getDate() + 6);

    const mStart = new Date(anchor.getFullYear(), anchor.getMonth(), 1);
    const mEnd   = new Date(anchor.getFullYear(), anchor.getMonth() + 1, 0);

    const u7s = new Date(anchor);  u7s.setDate(anchor.getDate() - 6);
    const u30s = new Date(anchor); u30s.setDate(anchor.getDate() - 29);

    return res.status(200).json({
      anchor:    isoDate(hoyIni),
      hoy:       { desde: isoDate(hoyIni),        hasta: isoDate(hoyFin) },
      ayer:      { desde: isoDate(ayerIni),       hasta: isoDate(ayerFin) },
      semana:    { desde: isoDate(atStart(wkStart)), hasta: isoDate(atEnd(wkEnd)) },
      mes:       { desde: isoDate(atStart(mStart)),  hasta: isoDate(atEnd(mEnd)) },
      ultimos7:  { desde: isoDate(atStart(u7s)),  hasta: isoDate(hoyFin) },
      ultimos30: { desde: isoDate(atStart(u30s)), hasta: isoDate(hoyFin) },
    });
  } catch (err) {
    console.error("❌ Error rangos fecha:", err);
    return res.status(500).json({ message: "Error al calcular rangos." });
  }
};

/* ───────────────────── Resumen principal ─────────────────────
   tipo: productos | combos | boletos | eventos | todos
──────────────────────────────────────────────────────── */
exports.obtenerResumen = async (req, res) => {
  const rango       = String(req.query.rango || "");
  const cajaId      = Number(req.query.caja_id) || null;
  const tipo        = String(req.query.tipo || "productos");
  const vendedorId  = Number(req.query.vendedor_id) || null;

  // Parser de fechas (LOCAL)
  const parseLocalYmd = (s) => {
    if (!s) return null;
    const str = String(s).trim();
    let y, m, d;

    if (/^\d{2}[\/-]\d{2}[\/-]\d{4}$/.test(str)) {
      const sep = str.includes('/') ? '/' : '-';
      [d, m, y] = str.split(sep).map(Number);
      return new Date(y, m - 1, d);
    }
    if (/^\d{4}[\/-]\d{2}[\/-]\d{2}$/.test(str)) {
      const sep = str.includes('/') ? '/' : '-';
      [y, m, d] = str.split(sep).map(Number);
      return new Date(y, m - 1, d);
    }
    const t = new Date(str);
    return isNaN(t) ? null : t;
  };

  // Resolver fechas por rango
  let dDesde, dHasta;
  if (rango === "hoy")          { dDesde = startOfToday();  dHasta = endOfToday(); }
  else if (rango === "semana")  { dDesde = startOfWeek();   dHasta = endOfWeek(); }
  else if (rango === "mes")     { dDesde = startOfMonth();  dHasta = endOfMonth(); }
  else if (rango === "personalizado") {
    const d1 = parseLocalYmd(req.query.desde);
    const d2 = parseLocalYmd(req.query.hasta);
    if (!d1 || !d2) return res.status(400).json({ message: "Fechas inválidas" });
    dDesde = atStart(d1); dHasta = atEnd(d2);
  } else {
    return res.status(400).json({ message: "rango inválido" });
  }

  // Validaciones como en tu vista
  if (!cajaId)     return res.status(400).json({ message: "caja_id requerido" });
  if (!vendedorId) return res.status(400).json({ message: "vendedor_id requerido" });

  let cn;
  try {
    cn = await db.getConnection();

    const bindsBase = { f1: dDesde, f2: dHasta, cajaId, vendedorId };

    /* ───── Productos (POS) ───── */
    const qProductos = `
      SELECT
        p.NOMBRE               AS NOMBRE,
        'Producto'             AS TIPO,
        SUM(dv.CANTIDAD)       AS CANTIDAD,
        dv.PRECIO_UNITARIO     AS PRECIO,
        SUM(dv.SUBTOTAL_LINEA) AS SUBTOTAL
      FROM pos_ventas v
      JOIN pos_detalle_venta dv ON dv.ID_VENTA = v.ID_VENTA
      JOIN pos_producto_nuevo p ON p.ID        = dv.PRODUCTO_ID
      WHERE v.FECHA BETWEEN :f1 AND :f2
        AND v.CAJA_ID    = :cajaId
        AND v.USUARIO_ID = :vendedorId
      GROUP BY p.NOMBRE, dv.PRECIO_UNITARIO
    `;

    /* ───── Combos (POS) ───── */
    const qCombos = `
      SELECT
        c.NOMBRE               AS NOMBRE,
        'Combo'                AS TIPO,
        SUM(vc.CANTIDAD)       AS CANTIDAD,
        vc.PRECIO_UNITARIO     AS PRECIO,
        SUM(vc.SUBTOTAL_LINEA) AS SUBTOTAL
      FROM pos_ventas v
      JOIN pos_venta_combo vc ON vc.ID_VENTA = v.ID_VENTA
      JOIN pos_combo c        ON c.ID       = vc.COMBO_ID
      WHERE v.FECHA BETWEEN :f1 AND :f2
        AND v.CAJA_ID    = :cajaId
        AND v.USUARIO_ID = :vendedorId
      GROUP BY c.NOMBRE, vc.PRECIO_UNITARIO
    `;

    /* ───── Boletos (Taquilla)
       Mismo criterio que getReporteVentaBoletos:
       - Rango con FUNCIONES.FECHA
       - SUM de NVL(e.PRECIO, f.PRECIO)
       - COUNT de entradas
       * En tu modelo actual no hay CAJA_ID/USUARIO_ID en COMPRAS; por eso no se filtran aquí. */
    const qBoletos = `
      SELECT
        'Boleto' AS NOMBRE,
        'Boleto' AS TIPO,
        COUNT(e.ID_ENTRADA) AS CANTIDAD,
        CASE WHEN COUNT(e.ID_ENTRADA) > 0
             THEN ROUND( SUM(NVL(e.PRECIO, f.PRECIO))/COUNT(e.ID_ENTRADA), 2 )
             ELSE 0 END AS PRECIO,
        SUM(NVL(e.PRECIO, f.PRECIO)) AS SUBTOTAL
      FROM COMPRAS c
      JOIN ENTRADAS e         ON e.ID_COMPRA = c.ID_COMPRA
      JOIN FUNCION_ASIENTO fa ON fa.ID_FA    = e.ID_FA
      JOIN FUNCIONES f        ON f.ID_FUNCION= fa.ID_FUNCION
      WHERE f.FECHA BETWEEN :f1 AND :f2
        AND c.ESTADO IN ('PAGADA','CONFIRMADA')
        AND (e.ESTADO IN ('EMITIDA','PAGADA','CONFIRMADA') OR e.ESTADO IS NULL)
      GROUP BY 'Boleto','Boleto'
    `;

    /* ───── Eventos (POS_PAGO_EVENTO)
       Filtra por caja (apertura) y por vendedor. */
    const qEventos = `
      SELECT
        'Evento especial' AS NOMBRE,
        'Evento'          AS TIPO,
        COUNT(p.ID)       AS CANTIDAD,
        CASE WHEN COUNT(p.ID) > 0
             THEN ROUND( SUM(NVL(p.MONTO_GTQ,0))/COUNT(p.ID), 2 )
             ELSE 0 END  AS PRECIO,
        SUM(NVL(p.MONTO_GTQ,0)) AS SUBTOTAL
      FROM POS_PAGO_EVENTO p
      LEFT JOIN POS_APERTURA_CAJA a ON a.ID_APERTURA = p.APERTURA_ID
      WHERE p.FECHA_PAGO BETWEEN :f1 AND :f2
        AND p.ESTADO = 'PAGADO'
        AND p.USUARIO_ID = :vendedorId
        AND a.CAJA_ID    = :cajaId
      GROUP BY 'Evento especial','Evento'
    `;

    let rows = [];

    if (tipo === "productos") {
      const rs = await cn.execute(qProductos, bindsBase, { outFormat: oracledb.OUT_FORMAT_OBJECT });
      rows = rs.rows || [];
    } else if (tipo === "combos") {
      const rs = await cn.execute(qCombos, bindsBase, { outFormat: oracledb.OUT_FORMAT_OBJECT });
      rows = rs.rows || [];
    } else if (tipo === "boletos") {
      const rs = await cn.execute(qBoletos, { f1: dDesde, f2: dHasta }, { outFormat: oracledb.OUT_FORMAT_OBJECT });
      rows = rs.rows || [];
    } else if (tipo === "eventos") {
      const rs = await cn.execute(qEventos, bindsBase, { outFormat: oracledb.OUT_FORMAT_OBJECT });
      rows = rs.rows || [];
    } else if (tipo === "todos") {
      const [p, c, b, e] = await Promise.all([
        cn.execute(qProductos, bindsBase, { outFormat: oracledb.OUT_FORMAT_OBJECT }),
        cn.execute(qCombos,    bindsBase, { outFormat: oracledb.OUT_FORMAT_OBJECT }),
        cn.execute(qBoletos,   { f1: dDesde, f2: dHasta }, { outFormat: oracledb.OUT_FORMAT_OBJECT }),
        cn.execute(qEventos,   bindsBase, { outFormat: oracledb.OUT_FORMAT_OBJECT }),
      ]);
      rows = [...(p.rows||[]), ...(c.rows||[]), ...(b.rows||[]), ...(e.rows||[])];
    } else {
      return res.status(400).json({ message: "tipo inválido" });
    }

    const data = (rows || [])
      .map(r => ({
        nombre:   r.NOMBRE,
        tipo:     r.TIPO || (tipo === "productos" ? "Producto" : tipo === "combos" ? "Combo" : ""),
        cantidad: Number(r.CANTIDAD || 0),
        precio:   Number(r.PRECIO   || 0),
        subtotal: Number(r.SUBTOTAL || 0),
      }))
      .sort((a, b) => b.subtotal - a.subtotal || a.nombre.localeCompare(b.nombre));

    const total = data.reduce((s, x) => s + x.subtotal, 0);

    return res.status(200).json({ ok: true, rows: data, total });

  } catch (err) {
    console.error("❌ Error obtenerResumen:", err);
    return res.status(500).json({ message: "Error al obtener resumen." });
  } finally {
    if (cn) try { await cn.close(); } catch {}
  }
};
