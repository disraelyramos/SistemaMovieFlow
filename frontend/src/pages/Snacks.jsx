// src/pages/Snacks.jsx
import React, { useEffect, useMemo, useState, useRef } from 'react';
import { useNavigate } from 'react-router-dom';

const API_BASE =
  import.meta?.env?.VITE_API_BASE ||
  import.meta?.env?.VITE_API_BASE_URL ||
  import.meta?.env?.VITE_API_URL ||
  'http://localhost:3001';

/* ===== Helpers ===== */
const authHeaders = () => {
  const t = localStorage.getItem('mf_token');
  return t ? { Authorization: `Bearer ${t}` } : {};
};
const fmtQ = (n) => `Q ${Number(n || 0).toFixed(2)}`;

// fetch JSON con opciones (headers, etc.)
async function tryFetchJson(url, options = {}) {
  const res = await fetch(url, {
    method: 'GET',
    headers: { Accept: 'application/json', ...(options.headers || {}) },
    ...options,
  });
  if (!res.ok) throw new Error(`HTTP ${res.status}`);
  return res.json();
}

function normalizeProducto(p) {
  const id =
    p.ID ?? p.id ?? p.ID_PRODUCTO ?? p.id_producto ?? p.ID_PROD ?? p.id_prod;
  const nombre =
    p.NOMBRE ?? p.nombre ?? p.descripcion ?? p.descripcion_corta ?? 'Producto';
  const precio =
    p.PRECIO_VENTA ?? p.precio_venta ?? p.precio ?? p.PRECIO ?? p.precioVenta ?? 0;
  const img = p.IMAGEN_URL ?? p.imagen_url ?? p.imagen ?? p.foto ?? null;
  return { tipo: 'PRODUCTO', id, nombre, precio: Number(precio || 0), img };
}

function normalizeCombo(c) {
  const id = c.ID ?? c.id ?? c.combo_id;
  const nombre = c.NOMBRE ?? c.nombre ?? 'Combo';
  const precio = c.PRECIO_VENTA ?? c.precio_venta ?? c.precio ?? 0;
  const img = c.IMAGEN_URL ?? c.imagen_url ?? c.imagen ?? c.foto ?? null;
  return { tipo: 'COMBO', id, nombre, precio: Number(precio || 0), img };
}

// id estable cuando falte
const stableId = (s) =>
  ('f_' +
    Math.abs(
      Array.from(String(s || 'x')).reduce((a, c) => ((a << 5) - a + c.charCodeAt(0)) | 0, 0)
    ).toString(36));

// 18:30 — 21:30 bonito
const fmtHora = (v) => {
  try {
    if (/^\d{1,2}:\d{2}(:\d{2})?$/.test(String(v))) return String(v).slice(0, 5);
    const d = new Date(v);
    if (!isNaN(d)) return d.toLocaleTimeString([], { hour: '2-digit', minute: '2-digit' });
  } catch {}
  return v ?? '';
};

function normalizeFuncion(f) {
  const id =
    f.id ?? f.ID ?? f.id_funcion ?? f.ID_FUNCION ?? f.funcion_id ?? f.FuncionID;

  const salaId =
    f.salaId ?? f.SALA_ID ?? f.id_sala ?? f.ID_SALA ?? f.sala_id ?? f.sala?.id;

  const salaNombre =
    f.salaNombre ?? f.SALA_NOMBRE ?? f.sala_nombre ?? f.salaName ?? f.sala?.nombre ?? '';

  const horaInicio =
    f.horaInicio ?? f.HORA_INICIO_TX ?? f.hora_inicio ?? f.inicio ?? f.fechaHoraInicio ?? f.startTime;

  const horaFin =
    f.horaFinal ?? f.HORA_FINAL_TX ?? f.horaFin ?? f.hora_fin ?? f.fin ?? f.fechaHoraFin ?? f.endTime;

  const titulo =
    f.titulo ?? f.TITULO ?? f.pelicula ?? f.pelicula_titulo ?? f.movie?.titulo ?? '';

  return { id, salaId, salaNombre, horaInicio, horaFin, titulo };
}

// etiqueta amigable para el <option>
const labelFuncion = (f) => {
  const sala = f.salaNombre || f.salaId || '—';
  const horas = f.horaInicio || f.horaFin ? `${fmtHora(f.horaInicio)} — ${fmtHora(f.horaFin)}` : '';
  return `${f.titulo ? `${f.titulo} · ` : ''}Sala ${sala}${horas ? ` · ${horas}` : ''}`;
};

/* ===== Candidatos de imagen (productos/combos) ===== */
const toAbs = (p) => (p?.startsWith('http') ? p : `${API_BASE}${p?.startsWith('/') ? p : '/' + p}`);

const getImgCandidates = (it) => {
  const list = [];
  if (it.img) list.push(toAbs(it.img));
  if (it.tipo === 'PRODUCTO') {
    list.push(`${API_BASE}/api/productos/${it.id}/imagen`);
    // respaldo adicional por si en algún entorno se expone por personal-ventas
    list.push(`${API_BASE}/api/personal-ventas/productos/${it.id}/imagen`);
  } else if (it.tipo === 'COMBO') {
    list.push(`${API_BASE}/api/combos/${it.id}/imagen`);
  }
  return Array.from(new Set(list.filter(Boolean)));
};

export default function Snacks() {
  const navigate = useNavigate();
  const [tab, setTab] = useState('TODOS'); // TODOS | PRODUCTOS | COMBOS
  const [productos, setProductos] = useState([]);
  const [combos, setCombos] = useState([]);
  const [loading, setLoading] = useState(true);

  const [cart, setCart] = useState([]); // {tipo, id, nombre, precio, qty}
  const total = useMemo(
    () => cart.reduce((s, it) => s + it.precio * it.qty, 0),
    [cart]
  );

  // Modal
  const [show, setShow] = useState(false);
  const [funciones, setFunciones] = useState([]);
  const [selFuncion, setSelFuncion] = useState(null);
  const [butaca, setButaca] = useState('');
  const [clienteNombre, setClienteNombre] = useState('');
  const [efectivo, setEfectivo] = useState('');

  // Avisos
  const [notice, setNotice] = useState(null); // { title, msg }
  const [toast, setToast] = useState(null);   // { title, msg, type }
  const toastTimer = useRef(null);
  const showToast = (payload) => {
    setToast(payload);
    if (toastTimer.current) clearTimeout(toastTimer.current);
    toastTimer.current = setTimeout(() => setToast(null), 3500);
  };
  const notify = (title, msg) => setNotice({ title, msg });

  useEffect(() => {
    (async () => {
      setLoading(true);

      // Productos
      const prodUrls = [`${API_BASE}/api/pedidos-snacks/catalogo/productos`];
      let prod = null;
      for (const u of prodUrls) {
        try { prod = await tryFetchJson(u, { headers: authHeaders() }); }
        catch { try { prod = await tryFetchJson(u); } catch {} }
        if (Array.isArray(prod) && prod.length) break;
      }
      const normP = (Array.isArray(prod) ? prod : []).map(normalizeProducto);

      // Combos
      const comboUrls = [`${API_BASE}/api/pedidos-snacks/catalogo/combos`];
      let cmb = null;
      for (const u of comboUrls) {
        try { cmb = await tryFetchJson(u, { headers: authHeaders() }); }
        catch { try { cmb = await tryFetchJson(u); } catch {} }
        if (Array.isArray(cmb) && cmb.length) break;
      }
      const normC = (Array.isArray(cmb) ? cmb : []).map(normalizeCombo);

      setProductos(normP);
      setCombos(normC);
      setLoading(false);
    })();
  }, []);

  const filtered = useMemo(() => {
    if (tab === 'PRODUCTOS') return productos;
    if (tab === 'COMBOS') return combos;
    return [...productos, ...combos];
  }, [tab, productos, combos]);

  const addToCart = (item) => {
    setCart((prev) => {
      const idx = prev.findIndex((x) => x.tipo === item.tipo && x.id === item.id);
      if (idx >= 0) {
        const copy = [...prev];
        copy[idx] = { ...copy[idx], qty: copy[idx].qty + 1 };
        return copy;
      }
      return [...prev, { ...item, qty: 1 }];
    });
  };

  const decQty = (item) => {
    setCart((prev) => {
      const idx = prev.findIndex((x) => x.tipo === item.tipo && x.id === item.id);
      if (idx < 0) return prev;
      const copy = [...prev];
      const q = copy[idx].qty - 1;
      if (q <= 0) copy.splice(idx, 1);
      else copy[idx] = { ...copy[idx], qty: q };
      return copy;
    });
  };

  const clearCart = () => setCart([]);

  const openModal = async () => {
    if (cart.length === 0) {
      notify('Carrito vacío', 'Agrega al menos 1 producto o combo.');
      return;
    }
    const url = `${API_BASE}/api/pedidos-snacks/funciones-activas`;
    let data = [];
    try { data = await tryFetchJson(url, { headers: authHeaders() }); }
    catch { try { data = await tryFetchJson(url); } catch {} }

    const rows = Array.isArray(data) ? data.filter(x => x && Object.keys(x).length) : [];
    const normF = rows.map(normalizeFuncion);

    if (!normF.length) {
      notify('Sin funciones activas', 'Actualmente no existen funciones activas.');
      return;
    }

    setFunciones(normF);
    setSelFuncion(null);
    setButaca('');
    setClienteNombre(() => {
      try {
        const raw = localStorage.getItem('mf_user');
        if (raw) {
          const u = JSON.parse(raw);
          return u?.name || u?.nombre || u?.given_name || '';
        }
      } catch {}
      return '';
    });
    setEfectivo(total.toFixed(2));
    setShow(true);
  };

  const closeModal = () => setShow(false);

  const submitPedido = async () => {
    if (!selFuncion) return notify('Falta seleccionar función', 'Selecciona tu función activa.');
    if (!butaca?.trim()) return notify('Butaca requerida', 'Ingresa tu butaca (por ejemplo: B12).');
    if (!clienteNombre?.trim()) return notify('Nombre requerido', 'Ingresa tu nombre.');

    const efectivoNum = Number(efectivo);
    if (Number.isNaN(efectivoNum) || efectivoNum < total) {
      return notify(
        'Efectivo insuficiente',
        `Debe ser un número válido y cubrir el total de ${fmtQ(total)}.`
      );
    }

    const items = cart.map((i) => ({ tipo: i.tipo, id: i.id, cantidad: i.qty }));

    const body = {
      clienteNombre,
      funcionId: selFuncion.id,
      salaId: selFuncion.salaId,
      asientoCod: butaca.trim().toUpperCase(),
      items,
      totalGtq: Number(total.toFixed(2)),
      efectivoGtq: Number(efectivoNum.toFixed(2)),
    };

    try {
      const r = await fetch(`${API_BASE}/api/pedidos-snacks`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json', ...authHeaders() },
        body: JSON.stringify(body),
      });

      if (!r.ok) {
        let msg = 'No se pudo crear el pedido';
        try {
          const err = await r.json();
          if (err?.message) msg = err.message;
        } catch {
          try { msg = await r.text(); } catch {}
        }
        notify('No se puede crear el pedido', msg);
        return;
      }

      const data = await r.json();

      showToast({
        type: 'success',
        title: 'Pedido realizado',
        msg: 'Tu pedido fue enviado a la dulcería.',
      });

      setShow(false);
      clearCart();

      window.open(`${API_BASE}/api/pedidos-snacks/${data.idPedido}/pdf`, '_blank');
    } catch (e) {
      notify('No se puede crear el pedido', e?.message || 'Ocurrió un error inesperado.');
    }
  };

  return (
    <main className="wc-page" style={{ paddingBottom: 24, minHeight: '100vh', overflow: 'visible' }}>
      <style>{`
        /* Reset del scroll */
        html, body, #root, .wc-page {
          height: auto !important;
          min-height: 100% !important;
          overflow: visible !important;
          overflow-x: hidden !important;
        }

        /* Estilos principales rediseñados */
        .snx-hero {
          background: linear-gradient(135deg, #1e293b 0%, #0f172a 100%);
          border-radius: 24px;
          padding: 2rem;
          margin-bottom: 2rem;
          border: 1px solid rgba(255,255,255,0.1);
          box-shadow: 0 20px 40px rgba(0,0,0,0.3);
        }

        .snx-hero-content {
          display: flex;
          align-items: center;
          justify-content: space-between;
          gap: 2rem;
        }

        .snx-hero-text h1 {
          font-size: 2.5rem;
          font-weight: 800;
          margin: 0 0 0.5rem 0;
          background: linear-gradient(135deg, #fff 0%, #fbbf24 100%);
          -webkit-background-clip: text;
          -webkit-text-fill-color: transparent;
        }

        .snx-hero-text p {
          font-size: 1.1rem;
          opacity: 0.9;
          margin: 0;
          color: #cbd5e1;
        }

        .snx-hero-actions {
          display: flex;
          gap: 1rem;
          flex-shrink: 0;
        }

        /* Tabs rediseñadas */
        .snx-tabs {
          display: flex;
          gap: 0.5rem;
          background: rgba(255,255,255,0.05);
          padding: 0.5rem;
          border-radius: 16px;
          margin-bottom: 2rem;
          border: 1px solid rgba(255,255,255,0.1);
        }

        .snx-tab {
          padding: 0.75rem 1.5rem;
          border: none;
          border-radius: 12px;
          background: transparent;
          color: #cbd5e1;
          font-weight: 600;
          cursor: pointer;
          transition: all 0.3s ease;
        }

        .snx-tab.active {
          background: linear-gradient(135deg, #f59e0b 0%, #d97706 100%);
          color: white;
          box-shadow: 0 4px 12px rgba(245, 158, 11, 0.3);
        }

        .snx-tab:hover:not(.active) {
          background: rgba(255,255,255,0.1);
          color: white;
        }

        /* Grid de productos rediseñado */
        .snx-grid {
          display: grid;
          grid-template-columns: repeat(auto-fill, minmax(280px, 1fr));
          gap: 1.5rem;
        }

        .snx-product-card {
          background: linear-gradient(135deg, rgba(255,255,255,0.05) 0%, rgba(255,255,255,0.02) 100%);
          border: 1px solid rgba(255,255,255,0.1);
          border-radius: 20px;
          padding: 1.5rem;
          transition: all 0.3s ease;
          backdrop-filter: blur(10px);
          position: relative;
          overflow: hidden;
        }

        .snx-product-card:hover {
          transform: translateY(-8px);
          border-color: rgba(245, 158, 11, 0.3);
          box-shadow: 0 20px 40px rgba(0,0,0,0.4);
        }

        .snx-product-badge {
          position: absolute;
          top: 1rem;
          right: 1rem;
          background: linear-gradient(135deg, #f59e0b 0%, #d97706 100%);
          color: white;
          padding: 0.25rem 0.75rem;
          border-radius: 20px;
          font-size: 0.75rem;
          font-weight: 700;
          text-transform: uppercase;
          letter-spacing: 0.5px;
        }

        .snx-product-image {
          width: 100%;
          height: 180px;
          border-radius: 12px;
          margin-bottom: 1rem;
          overflow: hidden;
          background: linear-gradient(135deg, #1e293b 0%, #334155 100%);
          display: flex;
          align-items: center;
          justify-content: center;
        }

        .snx-product-image img {
          width: 100%;
          height: 100%;
          object-fit: cover;
          transition: transform 0.3s ease;
        }

        .snx-product-card:hover .snx-product-image img {
          transform: scale(1.05);
        }

        .snx-product-name {
          font-size: 1.25rem;
          font-weight: 700;
          margin: 0 0 0.5rem 0;
          color: white;
          line-height: 1.3;
        }

        .snx-product-price {
          font-size: 1.5rem;
          font-weight: 800;
          color: #fbbf24;
          margin: 0 0 1rem 0;
          text-shadow: 0 2px 4px rgba(0,0,0,0.3);
        }

        .snx-product-actions {
          display: flex;
          gap: 0.75rem;
        }

        .snx-add-btn {
          flex: 1;
          background: linear-gradient(135deg, #10b981 0%, #059669 100%);
          border: none;
          color: white;
          padding: 0.75rem 1.5rem;
          border-radius: 12px;
          font-weight: 700;
          cursor: pointer;
          transition: all 0.3s ease;
          display: flex;
          align-items: center;
          justify-content: center;
          gap: 0.5rem;
        }

        .snx-add-btn:hover {
          transform: translateY(-2px);
          box-shadow: 0 8px 20px rgba(16, 185, 129, 0.4);
        }

        /* Carrito rediseñado */
        .snx-cart-sidebar {
          background: linear-gradient(135deg, rgba(255,255,255,0.05) 0%, rgba(255,255,255,0.02) 100%);
          border: 1px solid rgba(255,255,255,0.1);
          border-radius: 20px;
          padding: 1.5rem;
          height: fit-content;
          position: sticky;
          top: 2rem;
          backdrop-filter: blur(10px);
        }

        .snx-cart-header {
          display: flex;
          align-items: center;
          gap: 0.75rem;
          margin-bottom: 1.5rem;
          padding-bottom: 1rem;
          border-bottom: 1px solid rgba(255,255,255,0.1);
        }

        .snx-cart-header h3 {
          margin: 0;
          font-size: 1.5rem;
          font-weight: 700;
          color: white;
        }

        .snx-cart-icon {
          width: 40px;
          height: 40px;
          background: linear-gradient(135deg, #f59e0b 0%, #d97706 100%);
          border-radius: 12px;
          display: flex;
          align-items: center;
          justify-content: center;
          font-size: 1.25rem;
        }

        .snx-cart-items {
          display: flex;
          flex-direction: column;
          gap: 1rem;
          margin-bottom: 1.5rem;
          max-height: 400px;
          overflow-y: auto;
        }

        .snx-cart-item {
          display: flex;
          align-items: center;
          gap: 1rem;
          padding: 1rem;
          background: rgba(255,255,255,0.05);
          border-radius: 12px;
          border: 1px solid rgba(255,255,255,0.1);
        }

        .snx-cart-item-info {
          flex: 1;
        }

        .snx-cart-item-name {
          font-weight: 600;
          color: white;
          margin: 0 0 0.25rem 0;
        }

        .snx-cart-item-details {
          font-size: 0.875rem;
          opacity: 0.7;
          margin: 0;
        }

        .snx-cart-item-controls {
          display: flex;
          align-items: center;
          gap: 0.5rem;
        }

        .snx-cart-qty-btn {
          width: 32px;
          height: 32px;
          border: 1px solid rgba(255,255,255,0.2);
          background: rgba(255,255,255,0.1);
          color: white;
          border-radius: 8px;
          cursor: pointer;
          display: flex;
          align-items: center;
          justify-content: center;
          transition: all 0.2s ease;
        }

        .snx-cart-qty-btn:hover {
          background: rgba(255,255,255,0.2);
        }

        .snx-cart-qty {
          min-width: 40px;
          text-align: center;
          font-weight: 600;
          color: white;
        }

        .snx-cart-total {
          display: flex;
          justify-content: space-between;
          align-items: center;
          padding: 1rem 0;
          border-top: 1px solid rgba(255,255,255,0.1);
          margin-bottom: 1.5rem;
        }

        .snx-cart-total-label {
          font-size: 1.125rem;
          font-weight: 600;
          color: white;
        }

        .snx-cart-total-amount {
          font-size: 1.5rem;
          font-weight: 800;
          color: #fbbf24;
        }

        .snx-cart-actions {
          display: flex;
          gap: 0.75rem;
        }

        .snx-clear-btn {
          flex: 1;
          background: rgba(239, 68, 68, 0.2);
          border: 1px solid rgba(239, 68, 68, 0.3);
          color: #ef4444;
          padding: 0.75rem 1.5rem;
          border-radius: 12px;
          font-weight: 600;
          cursor: pointer;
          transition: all 0.3s ease;
        }

        .snx-clear-btn:hover {
          background: rgba(239, 68, 68, 0.3);
          transform: translateY(-2px);
        }

        .snx-checkout-btn {
          flex: 2;
          background: linear-gradient(135deg, #3b82f6 0%, #1d4ed8 100%);
          border: none;
          color: white;
          padding: 0.75rem 1.5rem;
          border-radius: 12px;
          font-weight: 700;
          cursor: pointer;
          transition: all 0.3s ease;
          display: flex;
          align-items: center;
          justify-content: center;
          gap: 0.5rem;
        }

        .snx-checkout-btn:hover {
          transform: translateY(-2px);
          box-shadow: 0 8px 20px rgba(59, 130, 246, 0.4);
        }

        /* Layout principal */
        .snx-main-layout {
          display: grid;
          grid-template-columns: 1fr 380px;
          gap: 2rem;
          align-items: start;
        }

        @media (max-width: 1024px) {
          .snx-main-layout {
            grid-template-columns: 1fr;
          }
          
          .snx-cart-sidebar {
            position: static;
          }
          
          .snx-hero-content {
            flex-direction: column;
            text-align: center;
          }
          
          .snx-hero-actions {
            justify-content: center;
          }
        }

        /* Estados vacíos */
        .snx-empty-state {
          text-align: center;
          padding: 3rem 2rem;
          color: #64748b;
        }

        .snx-empty-icon {
          font-size: 4rem;
          margin-bottom: 1rem;
          opacity: 0.5;
        }

        .snx-empty-text {
          font-size: 1.125rem;
          margin-bottom: 1rem;
        }

        /* Loading state */
        .snx-loading {
          display: flex;
          justify-content: center;
          align-items: center;
          padding: 3rem;
          color: #64748b;
        }

        /* ===== ESTILOS ORIGINALES DEL MODAL (RESTAURADOS) ===== */
        .snx-backdrop {
          position: fixed; inset: 0; display: grid; place-items: center;
          background: color-mix(in oklab, #000 55%, transparent);
          backdrop-filter: blur(4px);
          z-index: 9999;
          animation: snxFade .18s ease-out;
        }
        @keyframes snxFade { from { opacity: .0 } to { opacity: 1 } }

        .snx-modal {
          width: min(780px, 94vw);
          border-radius: 16px;
          padding: 0;
          overflow: hidden;
          background: linear-gradient(180deg, rgba(255,255,255,.06), rgba(255,255,255,.02));
          box-shadow: 0 20px 60px rgba(0,0,0,.45), inset 0 1px 0 rgba(255,255,255,.06);
        }
        .snx-head { display:flex; align-items:center; gap:12px; padding:16px 18px; border-bottom:1px solid rgba(255,255,255,.06); }
        .snx-title { font-size: 18px; font-weight: 700; margin: 0; }
        .snx-close { margin-left:auto; border:0; background:transparent; color:inherit; width:36px; height:36px; border-radius:10px; cursor:pointer; }
        .snx-close:hover { background: rgba(255,255,255,.06) }
        .snx-body { padding: 18px; display: grid; gap: 16px; grid-template-columns: 1.1fr .9fr; }
        @media (max-width: 860px) { .snx-body { grid-template-columns: 1fr } }
        .snx-card { border:1px solid rgba(255,255,255,.08); border-radius:12px; padding:14px; background: rgba(12,18,30,.6); }
        .snx-field { display:grid; gap:6px; margin-bottom:12px }
        .snx-label { font-size: 12px; opacity:.85 }
        .snx-input, .snx-select { width:100%; height:40px; border-radius:10px; border:1px solid rgba(255,255,255,.12); background:rgba(255,255,255,.04); color:inherit; padding:0 12px; outline:none; }
        .snx-input[readonly] { opacity:.75 }
        .snx-select { color-scheme: dark; } .snx-select option { background:#0c121e; color:#e8eef9; }
        .snx-actions { display:flex; gap:10px; padding:14px 18px; border-top:1px solid rgba(255,255,255,.06); background: linear-gradient(180deg, transparent, rgba(255,255,255,.02)); }

        .snx-notice { width:min(520px,92vw); border-radius:16px; padding:0; overflow:hidden; background: linear-gradient(180deg, rgba(255,255,255,.07), rgba(255,255,255,.03)); box-shadow:0 22px 68px rgba(0,0,0,.55), inset 0 1px 0 rgba(255,255,255,.06); }
        .snx-notice-head { display:flex; align-items:center; gap:12px; padding:16px 18px; border-bottom:1px solid rgba(255,255,255,.06); }
        .snx-notice-body { padding:18px; }
        .snx-notice-actions { display:flex; justify-content:flex-end; gap:10px; padding:12px 18px; border-top:1px solid rgba(255,255,255,.06); }

        .snx-toast-wrap { position: fixed; inset: 18px 0 auto 0; display:flex; justify-content:center; z-index: 10000; pointer-events:none; }
        .snx-toast { pointer-events:auto; display:flex; align-items:flex-start; gap:12px; min-width:260px; max-width:520px; background: linear-gradient(180deg, rgba(26,40,24,.9), rgba(18,30,18,.9)); border:1px solid rgba(120,200,120,.35); box-shadow:0 18px 58px rgba(0,0,0,.45), inset 0 1px 0 rgba(255,255,255,.06); color:#e8ffe8; padding:12px 14px; border-radius:12px; animation: snxSlide .22s ease-out; }
        .snx-toast-icon { width:26px; height:26px; border-radius:999px; display:grid; place-items:center; background:rgba(120,200,120,.25); border:1px solid rgba(120,200,120,.45); font-size:16px; }
        .snx-toast-title { margin:0; font-weight:700; }
        .snx-toast-msg { margin:2px 0 0; opacity:.9; }
        .snx-toast-btn { margin-left:auto; background:transparent; border:0; color:#c9ffcc; padding:6px 8px; border-radius:8px; cursor:pointer; }
        .snx-toast-btn:hover { background: rgba(255,255,255,.06); }
        @keyframes snxSlide { from { transform: translateY(-8px); opacity: 0 } to { transform: translateY(0); opacity: 1 } }
      `}</style>

      <section className="wc-section">
        <div className="wc-container">
          {/* Hero Section */}
          <div className="snx-hero">
            <div className="snx-hero-content">
              <div className="snx-hero-text">
                <h1>🍿 Snacks & Combos</h1>
                <p>Elige tus productos favoritos y disfruta durante la función</p>
              </div>
              <div className="snx-hero-actions">
                <button className="wc-btn wc-btn-ghost" onClick={() => navigate('/welcome-cliente')}>
                  🏠 Inicio
                </button>
                <button className="wc-btn wc-btn-primary" onClick={() => navigate('/mis-pedidos-snacks')}>
                  📒 Mis Pedidos
                </button>
              </div>
            </div>
          </div>

          {/* Tabs */}
          <div className="snx-tabs">
            {['TODOS', 'PRODUCTOS', 'COMBOS'].map((t) => (
              <button
                key={t}
                className={`snx-tab ${tab === t ? 'active' : ''}`}
                onClick={() => setTab(t)}
              >
                {t === 'TODOS' ? '🎯 Todos' : t === 'PRODUCTOS' ? '🥤 Productos' : '🎁 Combos'}
              </button>
            ))}
          </div>

          {/* Main Content */}
          <div className="snx-main-layout">
            {/* Product Grid */}
            <div>
              {loading ? (
                <div className="snx-loading">
                  <div>Cargando productos...</div>
                </div>
              ) : filtered.length === 0 ? (
                <div className="snx-empty-state">
                  <div className="snx-empty-icon">🍿</div>
                  <div className="snx-empty-text">No hay productos disponibles</div>
                  <button className="wc-btn wc-btn-primary" onClick={() => setTab('TODOS')}>
                    Ver todos los productos
                  </button>
                </div>
              ) : (
                <div className="snx-grid">
                  {filtered.map((it) => {
                    const candidates = getImgCandidates(it);
                    return (
                      <article key={`${it.tipo}-${it.id}`} className="snx-product-card">
                        <div className="snx-product-badge">
                          {it.tipo === 'COMBO' ? 'COMBO' : 'PRODUCTO'}
                        </div>
                        
                        <div className="snx-product-image">
                          {candidates.length > 0 ? (
                            <img
                              src={candidates[0]}
                              alt={it.nombre}
                              data-idx="0"
                              onError={(e) => {
                                const idx = Number(e.currentTarget.dataset.idx || 0);
                                const next = candidates[idx + 1];
                                if (next) {
                                  e.currentTarget.dataset.idx = String(idx + 1);
                                  e.currentTarget.src = next;
                                } else {
                                  e.currentTarget.style.display = 'none';
                                }
                              }}
                            />
                          ) : (
                            <span style={{ opacity: 0.5, fontSize: '3rem' }}>
                              {it.tipo === 'COMBO' ? '🎁' : '🥤'}
                            </span>
                          )}
                        </div>

                        <h3 className="snx-product-name">{it.nombre}</h3>
                        <div className="snx-product-price">{fmtQ(it.precio)}</div>

                        <div className="snx-product-actions">
                          <button 
                            className="snx-add-btn" 
                            onClick={() => addToCart(it)}
                          >
                            <span>+</span>
                            Agregar
                          </button>
                        </div>
                      </article>
                    );
                  })}
                </div>
              )}
            </div>

            {/* Cart Sidebar */}
            <aside className="snx-cart-sidebar">
              <div className="snx-cart-header">
                <div className="snx-cart-icon">🛒</div>
                <h3>Tu Carrito</h3>
              </div>

              {cart.length === 0 ? (
                <div className="snx-empty-state" style={{padding: '2rem 1rem'}}>
                  <div className="snx-empty-icon">🛒</div>
                  <div className="snx-empty-text">Tu carrito está vacío</div>
                  <small style={{opacity: 0.7}}>Agrega productos para continuar</small>
                </div>
              ) : (
                <>
                  <div className="snx-cart-items">
                    {cart.map((it) => (
                      <div key={`${it.tipo}-${it.id}`} className="snx-cart-item">
                        <div className="snx-cart-item-info">
                          <div className="snx-cart-item-name">{it.nombre}</div>
                          <div className="snx-cart-item-details">
                            {fmtQ(it.precio)} × {it.qty} = {fmtQ(it.precio * it.qty)}
                          </div>
                        </div>
                        <div className="snx-cart-item-controls">
                          <button 
                            className="snx-cart-qty-btn" 
                            onClick={() => decQty(it)}
                          >
                            -
                          </button>
                          <div className="snx-cart-qty">{it.qty}</div>
                          <button 
                            className="snx-cart-qty-btn" 
                            onClick={() => addToCart(it)}
                          >
                            +
                          </button>
                        </div>
                      </div>
                    ))}
                  </div>

                  <div className="snx-cart-total">
                    <div className="snx-cart-total-label">Total:</div>
                    <div className="snx-cart-total-amount">{fmtQ(total)}</div>
                  </div>

                  <div className="snx-cart-actions">
                    <button className="snx-clear-btn" onClick={clearCart}>
                      Vaciar
                    </button>
                    <button className="snx-checkout-btn" onClick={openModal}>
                      <span>🎬</span>
                      Realizar Pedido
                    </button>
                  </div>
                </>
              )}
            </aside>
          </div>
        </div>
      </section>

      {/* ===== MODAL (RESTAURADO A LA VERSIÓN ORIGINAL) ===== */}
      {show && (
        <div role="dialog" aria-modal="true" className="snx-backdrop">
          <div className="snx-modal">
            <div className="snx-head">
              <h3 className="snx-title">Confirmar pedido</h3>
              <button className="snx-close" onClick={closeModal} aria-label="Cerrar">✕</button>
            </div>

            <div className="snx-body">
              {/* Columna izquierda: Datos */}
              <div className="snx-card">
                <div className="snx-field">
                  <label className="snx-label">Selecciona tu función (activas ahora)</label>
                  <select
                    className="snx-select"
                    value={selFuncion?.id ?? ''}
                    onChange={(e) => {
                      const val = e.target.value;
                      const f = funciones.find((x) => String(x.id) === String(val)) || null;
                      setSelFuncion(f);
                    }}
                  >
                    <option value="">— Selecciona —</option>
                    {funciones.map((f) => (
                      <option key={f.id} value={f.id}>
                        {labelFuncion(f)}
                      </option>
                    ))}
                  </select>
                  {funciones.length === 0 && (
                    <small style={{opacity:.75}}>No se detectaron funciones activas en este momento.</small>
                  )}
                </div>

                <div className="snx-field">
                  <label className="snx-label">Sala</label>
                  <input
                    className="snx-input"
                    value={selFuncion ? (selFuncion.salaNombre || selFuncion.salaId || '') : ''}
                    readOnly
                  />
                </div>

                <div className="snx-field">
                  <label className="snx-label">Ingresa tu butaca</label>
                  <input
                    className="snx-input"
                    placeholder="Ej. B12"
                    value={butaca}
                    onChange={(e) => setButaca(e.target.value)}
                  />
                </div>

                <div className="snx-field">
                  <label className="snx-label">Ingresa tu nombre</label>
                  <input
                    className="snx-input"
                    placeholder="Tu nombre"
                    value={clienteNombre}
                    onChange={(e) => setClienteNombre(e.target.value)}
                  />
                </div>
              </div>

              {/* Columna derecha: Totales */}
              <div className="snx-card">
                <div className="snx-field">
                  <label className="snx-label">Total a pagar</label>
                  <input className="snx-input" value={fmtQ(total)} readOnly />
                </div>

                <div className="snx-field">
                  <label className="snx-label">Efectivo con el que pagará</label>
                  <input
                    className="snx-input"
                    inputMode="decimal"
                    placeholder="Ej. 100.00"
                    value={efectivo}
                    onChange={(e) => setEfectivo(e.target.value)}
                  />
                </div>
              </div>
            </div>

            <div className="snx-actions">
              <button className="wc-btn wc-btn-ghost" onClick={closeModal}>Cancelar</button>
              <button className="wc-btn wc-btn-primary" onClick={submitPedido} style={{ marginLeft: 'auto' }}>
                Confirmar y crear pedido
              </button>
            </div>
          </div>
        </div>
      )}

      {/* ===== AVISO ELEGANTE ===== */}
      {notice && (
        <div role="dialog" aria-modal="true" className="snx-backdrop" onClick={() => setNotice(null)}>
          <div className="snx-notice" onClick={(e) => e.stopPropagation()}>
            <div className="snx-notice-head">
              <h3 className="snx-title" style={{ display:'flex', alignItems:'center', gap:10 }}>
                🎬 {notice.title}
              </h3>
            </div>
            <div className="snx-notice-body">
              <p style={{ margin: 0 }}>{notice.msg}</p>
            </div>
            <div className="snx-notice-actions">
              <button className="wc-btn wc-btn-primary" onClick={() => setNotice(null)}>Entendido</button>
            </div>
          </div>
        </div>
      )}

      {/* ===== TOAST ===== */}
      {toast && (
        <div className="snx-toast-wrap">
          <div className="snx-toast" role="status" aria-live="polite">
            <div className="snx-toast-icon">✔</div>
            <div>
              <p className="snx-toast-title">{toast.title || 'Éxito'}</p>
              {toast.msg && <p className="snx-toast-msg">{toast.msg}</p>}
            </div>
            <button className="snx-toast-btn" onClick={() => setToast(null)}>Cerrar</button>
          </div>
        </div>
      )}
    </main>
  );
}