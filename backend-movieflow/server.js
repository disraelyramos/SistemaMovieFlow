// server.js
const express = require('express');
const cors = require('cors');
require('dotenv').config();
const { getConnection } = require('./src/config/db');
const path = require('path');
const fs = require('fs');


const UPLOADS_DIR = process.env.UPLOADS_DIR || path.join(__dirname, 'uploads');
if (!fs.existsSync(UPLOADS_DIR)) fs.mkdirSync(UPLOADS_DIR, { recursive: true });

const app = express();

/* ================= Middleware ================= */
app.use(cors({
  origin: process.env.CLIENT_ORIGIN || true,
  credentials: false,
  methods: ['GET', 'POST', 'PATCH', 'PUT', 'DELETE', 'OPTIONS'],
  // 👇 Cabeceras personalizadas que usamos en el proyecto
  allowedHeaders: [
    'Content-Type',
    'Authorization',
    'X-User-Id',
    'X-User-Email',
    'X-Mf-User'
  ],
}));
app.use(express.json());




/* ===== helper para detectar módulos mal exportados ===== */
function ensureRouter(mod, name) {
  if (typeof mod !== 'function') {
    console.error(`\n❌ ${name} NO exporta un Router de Express.`);
    console.error(`   typeof ${name}:`, typeof mod, 'valor:', mod);
    console.error('   Asegúrate de terminar el archivo con: module.exports = router;\n');
    process.exit(1);
  }
}

/* ==================== Rutas ==================== */
const authRoutes = require('./src/routes/auth.routes');
const authGoogleRoutes = require('./src/routes/authGoogle.routes');
const menuRoutes = require('./src/routes/menu.routes');
const usuariosRoutes = require('./src/routes/usuarios.routes');
const estadosRoutes = require('./src/routes/estados.routes');
const rolesRoutes = require('./src/routes/roles.routes');
const asignarMenuRoutes = require('./src/routes/asignarmenu.routes');
const categoriasRoutes = require('./src/routes/categorias.routes');
const clasificacionesRoutes = require('./src/routes/clasificaciones.routes');
const peliculasRoutes = require('./src/routes/peliculas.routes');
const categoriaProductosRoutes = require('./src/routes/categoriaproductos.routes');
const unidadMedidaRoutes = require('./src/routes/unidadmedida.routes');
const productoEstadosRoutes = require('./src/routes/productoestado.routes');
const calculoProductoRoutes = require('./src/routes/calculo-producto.routes');
const actualizarProductoRoutes = require('./src/routes/actualizar-producto.routes');
const nuevoProductoRoutes = require('./src/routes/nuevoproducto.routes');
const lotesRoutes = require('./src/routes/lotes.routes');
const estadosProductosRoutes = require('./src/routes/estados-productos.routes');
const combosRoutes = require('./src/routes/combo/combo.routes');
const personalVentasRoutes = require("./src/routes/ventas/personal-ventas.routes");
const cajaRoutes = require("./src/routes/caja/caja.routes");
const CierredelasCajasRoutes = require("./src/routes/caja/CierredelasCajas.routes");
const registrarCierreRoutes = require("./src/routes/caja/registrarCierre.routes");
const aperturaCajaRoutes = require("./src/routes/ventas/AperturaCaja.routes");
const corteCajaRoutes = require("./src/routes/ventas/corte-caja.routes");
const estadoVentaRoutes = require("./src/routes/ventas/estadoVenta.routes");
const turnosHorariosRoutes = require("./src/routes/ventas/TurnosHorarios.routes");
const tipoCambioRoutes = require('./src/routes/tipocambio.routes');
ensureRouter(tipoCambioRoutes, 'tipoCambioRoutes');
const excelRoutes = require('./src/routes/excel/detallesVentas.routes');
const reportesDeSalaExcelRoutes = require("./src/routes/excel/ReportesDeSala.routes");
const reportesSalasRouter = require('./src/routes/graficasReportes.routes');
const reportesRoutes = require('./src/routes/reportes.routes');
const pdfRouter = require('./src/routes/pdf/pdf.routes');
const passwordRoutes = require('./src/routes/recuperarcontrasena/recuperarContrasena.routes');
const pagosReservasRouter = require('./src/routes/pagosReservas.routes');
console.log('[DEBUG] typeof pagosReservasRouter =', typeof pagosReservasRouter);
const reportesEventosRouter = require('./src/routes/reportesEventos.routes');
const cierreDeCajaRouter = require('./src/routes/caja/CierredelasCajas.routes');
ensureRouter(cierreDeCajaRouter, 'cierreDeCajaRouter');
const reporteVentaBoletosRoutes = require('./src/routes/ReporteVentadeBoletos.routes');
const filtrosRoutes = require('./src/routes/filters.routes');
const pdfBoletosRoutes = require("./src/routes/pdf/pdfboletos.routes");
const excelBoletosRoutes = require("./src/routes/excel/boletos.routes");
const { startAutoCancelJob } = require('./src/jobs/autoCancelEventos.job');
//startAutoCancelJob(); // inicia el job
const ventasBoletos = require('./src/routes/ventasBoletos');

// ✅ con 'src' como el resto de rutas
const reportesEventosExcelRoutes = require("./src/routes/excel/ReportesEventos.routes");
const reportesEventosPdfRoutes   = require("./src/routes/pdf/reportesEventos.routes");
const pdfVentasCategoriaRoutes = require("./src/routes/pdf/VentasCategoria.routes");
const excelVentasCategoriaRoutes = require("./src/routes/excel/VentasCategoria.routes");


//Nueva para pedidos
const pedidosSnacksRoutes = require('./src/routes/pedidosSnacks.routes');
ensureRouter(pedidosSnacksRoutes, 'pedidosSnacksRoutes');

const funcionesRoutes = require('./src/routes/funciones.routes');                 // admin
const salasRoutes = require('./src/routes/salas.routes');                         // salas
const eventosReservadosRoutes = require('./src/routes/eventosReservados.routes'); // eventos

const clienteRoutes = require('./src/routes/cliente.routes');                     // cliente
const empleadoRoutes = require('./src/routes/empleado.routes');
const historialRoutes = require('./src/routes/historial.routes');

// === NUEVO: Mis reservas / Cancelar (RF04) ===
const reservasRoutes = require('./src/routes/reservas.routes');

// === NUEVO: Solicitudes de eventos (RF09/RF10) ===
const solicitudesRoutes = require('./src/routes/solicitudes.routes');

// === NUEVO: PDFs ===
const pdfDetallesRoutes = require('./src/routes/pdf/detalles.routes');                   // POST /detalles-venta
const pdfInicioAperturaRoutes = require('./src/routes/pdf/inicioaperturaCaja.routes');   // GET  /apertura-caja/:id_apertura, /corte-caja/:id_cierre

// === NUEVO: Ticket PDF (ventas) ===
const ticketPDFRoutes = require('./src/routes/ventas/ticketpdf.routes');

// --- verifica que cada require sea un Router (función)
[
  ['authRoutes', authRoutes],
  ['authGoogleRoutes', authGoogleRoutes],
  ['menuRoutes', menuRoutes],
  ['usuariosRoutes', usuariosRoutes],
  ['estadosRoutes', estadosRoutes],
  ['rolesRoutes', rolesRoutes],
  ['asignarMenuRoutes', asignarMenuRoutes],
  ['categoriasRoutes', categoriasRoutes],
  ['clasificacionesRoutes', clasificacionesRoutes],
  ['peliculasRoutes', peliculasRoutes],
  ['categoriaProductosRoutes', categoriaProductosRoutes],
  ['unidadMedidaRoutes', unidadMedidaRoutes],
  ['productoEstadosRoutes', productoEstadosRoutes],
  ['calculoProductoRoutes', calculoProductoRoutes],
  ['actualizarProductoRoutes', actualizarProductoRoutes],
  ['funcionesRoutes', funcionesRoutes],
  ['salasRoutes', salasRoutes],
  ['eventosReservadosRoutes', eventosReservadosRoutes],
  ['clienteRoutes', clienteRoutes],
  ['empleadoRoutes', empleadoRoutes],
  ['historialRoutes', historialRoutes],
  // === incluye los routers ya existentes ===
  ['reservasRoutes', reservasRoutes],
  // === incluye el router NUEVO de solicitudes ===
  ['solicitudesRoutes', solicitudesRoutes],
  // === incluye routers NUEVOS de PDF ===
  ['pdfDetallesRoutes', pdfDetallesRoutes],
  ['pdfInicioAperturaRoutes', pdfInicioAperturaRoutes],
  // === incluye router NUEVO de ticket PDF ===
  ['ticketPDFRoutes', ticketPDFRoutes],
].forEach(([name, mod]) => ensureRouter(mod, name));

/* ==================== Salud ==================== */
app.get('/', (req, res) => {
  res.send('API CinePeliz funcionando correctamente 🎬');
});

/* ==================== Públicas / auth ==================== */
app.use('/login', authRoutes);
app.use('/api/auth', authGoogleRoutes);

/* ==================== Catálogos/administración ==================== */
app.use('/api', menuRoutes);
app.use('/api/usuarios', usuariosRoutes);
app.use('/api/estados', estadosRoutes);
app.use('/api/roles', rolesRoutes);
app.use('/api', asignarMenuRoutes);
app.use('/api', categoriasRoutes);
app.use('/api/clasificaciones', clasificacionesRoutes);
app.use('/api', peliculasRoutes);
app.use('/api/categoria-productos', categoriaProductosRoutes);
app.use('/api/unidadmedida', unidadMedidaRoutes);
app.use('/api/producto-estados', productoEstadosRoutes);
app.use('/api/calculo-productos', calculoProductoRoutes);
app.use('/api/actualizar-producto', actualizarProductoRoutes);
app.use('/api/productos', nuevoProductoRoutes);
app.use('/api/lotes', lotesRoutes);
app.use('/api/estados-productos', estadosProductosRoutes);
app.use('/api/producto-por-lote', require('./src/routes/inventario/productoPorLote.routes'));
app.use('/api', combosRoutes);
app.use("/api/personal-ventas", personalVentasRoutes);
app.use("/api/cajas", cajaRoutes);
app.use("/api/cierredelascajas", CierredelasCajasRoutes);
app.use("/api/registrar-cierre", registrarCierreRoutes);
app.use("/api/ventas", aperturaCajaRoutes);
app.use("/api/corte-caja", corteCajaRoutes);
app.use("/api/estado-venta", estadoVentaRoutes);
app.use("/api/ventas", turnosHorariosRoutes);
app.use("/api", require("./src/routes/pdf/detalles.routes"));
app.use('/api/auth', require('./src/routes/auth/verifyAdmin.routes'));
app.use('/api/pedidos-snacks', pedidosSnacksRoutes);
app.use('/api/tipo-cambio', tipoCambioRoutes);
app.use('/api/excel', excelRoutes);
app.use("/api/excel", reportesDeSalaExcelRoutes);
app.use('/api/reportes-salas', reportesSalasRouter);
app.use('/api', reportesRoutes);
app.use('/api/pdf', pdfRouter);
app.use('/password', passwordRoutes); 
app.use('/api/pagos-reservas', pagosReservasRouter);
app.use('/api', reportesEventosRouter);
app.use("/api/excel", reportesEventosExcelRoutes);
app.use("/api/pdf", reportesEventosPdfRoutes);
app.use("/api/pdf", pdfVentasCategoriaRoutes);
app.use("/api/excel", excelVentasCategoriaRoutes);
app.use('/api/cierre-de-caja', cierreDeCajaRouter); 
app.use('/api', reporteVentaBoletosRoutes);
app.use('/api', filtrosRoutes);
app.use("/api/pdf", pdfBoletosRoutes);
app.use("/api/excel", excelBoletosRoutes);
app.use(ventasBoletos);

/* ==================== Salas y funciones (admin) ==================== */
app.use('/api/salas', salasRoutes);
app.use('/api/funciones', funcionesRoutes);

/* ==================== Eventos especiales del cliente ==================== */
app.use('/api/eventos-reservados', eventosReservadosRoutes);

/* ==================== Cliente / empleado / historial ==================== */
app.use('/api', clienteRoutes);
app.use('/api', empleadoRoutes);
app.use('/api', historialRoutes);

/* ==================== Mis reservas ==================== */
app.use('/api/reservas', reservasRoutes);

/* ==================== Solicitudes de eventos ==================== */
app.use('/api/solicitudes', solicitudesRoutes);

/* ==================== PDFs ==================== */
// Se montan bajo /api/pdf para mantener un prefijo único
app.use('/api/pdf', pdfDetallesRoutes);
app.use('/api/pdf', pdfInicioAperturaRoutes);

// === Ticket PDF (ventas)
app.use('/api/ticket-pdf', ticketPDFRoutes);

/* =========================================================
   ENDPOINTS DE APOYO PARA DASHBOARD (COMPRAS / ENTRADAS)
   ========================================================= */

/**
 * Recorre recursivamente la pila de Express y devuelve handlers GET cuyo path
 * cumpla la condición (matchFn).
 */
function collectGetHandlers(appOrRouter, matchFn) {
  const out = [];
  const stack =
    (appOrRouter && appOrRouter._router ? appOrRouter._router.stack : appOrRouter.stack) || [];
  for (const layer of stack) {
    if (layer.route && layer.route.methods && layer.route.methods.get) {
      const routePath = String(layer.route.path || '');
      if (matchFn(routePath)) {
        for (const s of layer.route.stack || []) {
          if (typeof s.handle === 'function') out.push({ path: routePath, handle: s.handle });
        }
      }
    } else if (layer.name === 'router' && layer.handle && layer.handle.stack) {
      out.push(...collectGetHandlers(layer.handle, matchFn));
    }
  }
  return out;
}

/**
 * Ejecuta el primer handler GET que coincida y devuelve lo que envíe a res.json(...).
 */
async function callFirstJson(app, matcher) {
  const handlers = collectGetHandlers(app, matcher);
  for (const h of handlers) {
    const data = await new Promise((resolve) => {
      const fakeReq = { method: 'GET', query: {}, params: {}, body: {}, headers: {}, user: null };
      const fakeRes = {
        status() { return this; },
        set() { return this; },
        json(payload) { resolve(payload); },
        send(payload) { try { resolve(JSON.parse(payload)); } catch { resolve(payload); } },
        end() { resolve(null); }
      };
      try { h.handle(fakeReq, fakeRes, () => resolve(null)); } catch { resolve(null); }
    });
    if (Array.isArray(data)) return data;
  }
  return null;
}

/** Helper para obtener TODAS las entradas (historial) vía handlers reales */
async function getAllEntradasViaHandlers() {
  // Busca algo tipo: /api/historial-venta-entradas, /api/historial/venta-entradas, etc.
  const data =
    await callFirstJson(app, (p) => /entrada/i.test(p) && /historial|venta/i.test(p)) ||
    await callFirstJson(app, (p) => /historial.*entrada/i.test(p)) ||
    await callFirstJson(app, (p) => /venta.*entrada/i.test(p));
  return Array.isArray(data) ? data : [];
}

// /api/entradas -> usa directamente el handler real del historial
app.get('/api/entradas', async (req, res) => {
  try {
    const { all } = req.query;
    if (!all) return res.json([]);
    const data = await getAllEntradasViaHandlers();
    return res.json(data);
  } catch (e) {
    console.error('ERR /api/entradas:', e);
    res.status(500).json({ error: 'Error listando ENTRADAS' });
  }
});

/**
 * /api/compras => “shim” a partir de ENTRADAS
 */
app.get('/api/compras', async (req, res) => {
  try {
    const { all } = req.query;
    if (!all) return res.json([]);

    const entradas = await getAllEntradasViaHandlers();
    if (!Array.isArray(entradas) || entradas.length === 0) return res.json([]);

    const grp = new Map();
    for (const e of entradas) {
      const idCompra = String(e.ID_COMPRA ?? e.id_compra ?? '').trim();
      if (!idCompra) continue;
      if (!grp.has(idCompra)) grp.set(idCompra, []);
      grp.get(idCompra).push(e);
    }

    const compras = [];
    for (const [idCompra, rows] of grp.entries()) {
      const estados = rows.map(r => String(r.ESTADO || r.estado || '').toUpperCase());
      const hayEmitida = estados.some(s => s.startsWith('EMITID'));
      const estado = hayEmitida ? 'PAGADA' : (estados.some(s => s.startsWith('RESERV')) ? 'PENDIENTE' : 'PENDIENTE');

      const monto = rows.reduce((s, r) => {
        const esEmitida = String(r.ESTADO || '').toUpperCase().startsWith('EMITID');
        const precio = Number(r.PRECIO ?? r.precio ?? 0) || 0;
        return s + (esEmitida ? precio : 0);
      }, 0);

      const fechas = rows
        .map(r => new Date(r.FECHA || r.fecha))
        .filter(d => !isNaN(d));
      const fecha = fechas.length ? new Date(Math.max(...fechas)) : null;

      const faCount = {};
      for (const r of rows) {
        const fa = String(r.ID_FA ?? r.id_fa ?? '').trim();
        if (!fa) continue;
        faCount[fa] = (faCount[fa] || 0) + 1;
      }
      const id_funcion = Object.entries(faCount).sort((a, b) => b[1] - a[1])[0]?.[0] || null;

      compras.push({
        ID_COMPRA: idCompra,
        ID_FUNCION: id_funcion,
        MONTO_TOTAL: monto,
        ESTADO: estado,
        METODO_PAGO: null,
        FECHA: fecha ? fecha.toISOString() : null,
      });
    }

    compras.sort((a, b) => (new Date(b.FECHA) - new Date(a.FECHA)));
    return res.json(compras);
  } catch (e) {
    console.error('ERR /api/compras:', e);
    res.status(500).json({ error: 'Error listando COMPRAS' });
  }
});


/* ==================== Archivos estáticos ==================== */
// Servir /uploads desde el directorio configurado
app.use('/uploads', express.static(UPLOADS_DIR, { fallthrough: false }));

// 404 claro si el archivo no existe
app.use('/uploads', (req, res) => {
  res.status(404).json({
    error: 'Archivo no encontrado',
    path: path.join(UPLOADS_DIR, req.path)
  });
});

// --- RUTAS DE DIAGNÓSTICO ---
// IP pública de salida del servidor (para agregarla a la ACL de OCI)
app.get('/debug/egress-ip', async (_req, res) => {
  try {
    const r = await fetch('https://ifconfig.me/ip');
    const ip = (await r.text()).trim();
    res.type('text/plain').send(ip);
  } catch (e) {
    res.status(500).type('text/plain').send(String(e));
  }
});

// Ping a Oracle para confirmar conexión desde el entorno (Railway)
app.get('/db-ping', async (_req, res) => {
  try {
    const conn = await getConnection();
    const result = await conn.execute('select 1 as OK from dual');
    await conn.close();
    res.json(result.rows); // [[1]] si todo ok
  } catch (e) {
    res.status(500).type('text/plain').send(String(e));
  }
});


/* ==================== Puerto ==================== */
const PORT = process.env.PORT || 3001;
app.listen(PORT, '0.0.0.0', () => {
  console.log(`Servidor backend corriendo en http://localhost:${PORT}`);
});

