// src/pages/MisPedidosSnacks.jsx
import React, { useEffect, useMemo, useState } from "react";
import { useNavigate } from "react-router-dom";

const API_BASE =
  import.meta?.env?.VITE_API_BASE ||
  import.meta?.env?.VITE_API_BASE_URL ||
  import.meta?.env?.VITE_API_URL ||
  "http://localhost:3001";

const authHeaders = () => {
  const t = localStorage.getItem("mf_token");
  return t ? { Authorization: `Bearer ${t}` } : {};
};
const fmtQ = (n) => `Q ${Number(n || 0).toFixed(2)}`;

async function tryFetchJson(url, options = {}) {
  const res = await fetch(url, {
    method: "GET",
    headers: { Accept: "application/json", ...(options.headers || {}) },
    ...options,
  });
  if (!res.ok) throw new Error(`HTTP ${res.status}`);
  return res.json();
}

// ===== util: ids cancelados en localStorage (solo lado cliente) =====
const LS_KEY = "mf_cancelled_snack_ids";
const readCancelled = () => {
  try {
    const arr = JSON.parse(localStorage.getItem(LS_KEY) || "[]");
    return Array.isArray(arr) ? arr : [];
  } catch {
    return [];
  }
};
const writeCancelled = (arr) => {
  try { localStorage.setItem(LS_KEY, JSON.stringify(arr)); } catch {}
};

// Normalizador (objeto o arreglo)
function normalizePedido(p) {
  if (Array.isArray(p)) {
    const [ID_PEDIDO, , , SALA_ID, ASIENTO_COD, TOTAL_GTQ, EFECTIVO_GTQ, CAMBIO_GTQ, ESTADO, CREATED_AT] = p;
    return {
      id: ID_PEDIDO ?? null,
      salaId: SALA_ID ?? null,
      asiento: ASIENTO_COD ?? null,
      total: Number(TOTAL_GTQ || 0),
      efectivo: Number(EFECTIVO_GTQ || 0),
      cambio: Number(CAMBIO_GTQ || 0),
      estado: ESTADO || "PENDIENTE",
      creado: CREATED_AT ?? null,
      items: [],
    };
  }
  const id = p?.id ?? p?.ID ?? p?.ID_PEDIDO ?? null;
  const salaId = p?.salaId ?? p?.SALA_ID ?? p?.sala ?? null;
  const asiento = p?.asiento ?? p?.asientoCod ?? p?.ASIENTO_COD ?? null;
  const total = p?.total ?? p?.totalGtq ?? p?.TOTAL_GTQ ?? 0;
  const efectivo = p?.efectivo ?? p?.efectivoGtq ?? p?.EFECTIVO_GTQ ?? 0;
  const cambio = p?.cambio ?? p?.cambioGtq ?? p?.CAMBIO_GTQ ?? 0;
  const estado = p?.estado ?? p?.ESTADO ?? "PENDIENTE";
  const creado = p?.creado ?? p?.createdAt ?? p?.CREATED_AT ?? p?.CREADO_STR ?? null;
  const items = Array.isArray(p?.items) ? p.items : [];
  return {
    id,
    salaId,
    asiento,
    total: Number(total || 0),
    efectivo: Number(efectivo || 0),
    cambio: Number(cambio || 0),
    estado,
    creado,
    items,
    salaNombre: p?.salaNombre ?? null,
  };
}

// 👉 Mapeo de sala visual
function salaDisplay(salaNombre, salaId) {
  if (salaNombre && String(salaNombre).trim() !== "") return `Sala ${salaNombre}`;
  if (salaId == null) return "Sala —";
  if (String(salaId) === "9") return "Sala A";
  return `Sala ${salaId}`;
}

// Estado con colores
function getEstadoStyles(estado) {
  const estadoUpper = String(estado).toUpperCase();
  switch (estadoUpper) {
    case "PENDIENTE":
      return {
        background: "linear-gradient(135deg, #f59e0b 0%, #d97706 100%)",
        color: "white"
      };
    case "ACEPTADO":
      return {
        background: "linear-gradient(135deg, #10b981 0%, #059669 100%)",
        color: "white"
      };
    case "ENTREGADO":
      return {
        background: "linear-gradient(135deg, #3b82f6 0%, #1d4ed8 100%)",
        color: "white"
      };
    default:
      return {
        background: "rgba(255,255,255,0.1)",
        color: "#cbd5e1"
      };
  }
}

export default function MisPedidosSnacks() {
  const navigate = useNavigate();
  const [raw, setRaw] = useState([]);
  const [loading, setLoading] = useState(true);
  const [cancelledIds, setCancelledIds] = useState(readCancelled());
  const [toast, setToast] = useState(null); // {msg}
  const [confirmBox, setConfirmBox] = useState(null); // {id, titulo, mensaje}
  const [filtro, setFiltro] = useState("TODOS"); // TODOS | PENDIENTE | ACEPTADO | ENTREGADO

  const load = async () => {
    setLoading(true);
    let data = [];
    try {
      data = await tryFetchJson(`${API_BASE}/api/pedidos-snacks/mis`, { headers: authHeaders() });
    } catch {
      try {
        data = await tryFetchJson(`${API_BASE}/api/pedidos-snacks/mis`);
      } catch {}
    }
    setRaw(Array.isArray(data) ? data : []);
    setLoading(false);
  };

  useEffect(() => {
    // 🔧 Forzar scroll completo en esta vista (por estilos globales que limitan)
    const prevOverflow = document.documentElement.style.overflowY;
    document.documentElement.style.overflowY = "auto";
    // Cargar y auto-refresh
    load();
    const id = setInterval(load, 10000);
    return () => {
      clearInterval(id);
      document.documentElement.style.overflowY = prevOverflow || "";
    };
  }, []);

  // Normaliza y quita cancelados locales
  const items = useMemo(() => {
    const norm = raw.map(normalizePedido);
    if (!cancelledIds?.length) return norm;
    const s = new Set(cancelledIds);
    return norm.filter((x) => !s.has(Number(x.id)));
  }, [raw, cancelledIds]);

  // Aplica filtro de estado seleccionado
  const visibles = useMemo(() => {
    const F = String(filtro).toUpperCase();
    if (F === "TODOS") return items;
    return items.filter((p) => String(p.estado).toUpperCase() === F);
  }, [items, filtro]);

  const openPdf = (id) => {
    if (id == null || Number.isNaN(Number(id))) {
      alert("No se pudo abrir el comprobante: ID inválido.");
      return;
    }
    window.open(`${API_BASE}/api/pedidos-snacks/${id}/pdf`, "_blank");
  };

  // ===== cancelar (con confirm modal), solo lado cliente =====
  const pedirConfirmacionCancel = (p) => {
    if (!p || String(p.estado).toUpperCase() !== "PENDIENTE") return;
    setConfirmBox({
      id: p.id,
      titulo: "Cancelar pedido",
      mensaje: `¿Seguro que deseas cancelar el Pedido #${p.id}?`,
    });
  };

  const confirmarCancelacion = () => {
    if (!confirmBox?.id) return;
    const idNum = Number(confirmBox.id);
    const next = Array.from(new Set([...(cancelledIds || []), idNum]));
    setCancelledIds(next);
    writeCancelled(next);
    setConfirmBox(null);
    setToast({ msg: "Pedido eliminado" });
    setTimeout(() => setToast(null), 2500);
  };

  const cerrarConfirm = () => setConfirmBox(null);

  return (
    <main className="wc-page">
      <style>{`
        /* ======= FIX DE SCROLL GLOBAL PARA ESTA PÁGINA ======= */
        html, body, #root, .wc-page {
          height: auto !important;
          min-height: 100% !important;
          overflow-y: auto !important;
          overflow-x: hidden !important;
        }
        
        .wc-page {
          min-height: 100vh;
          overflow: visible !important;
        }

        /* ======= Estilos rediseñados ======= */
        .mps-hero {
          background: linear-gradient(135deg, #1e293b 0%, #0f172a 100%);
          border-radius: 24px;
          padding: 2rem;
          margin-bottom: 2rem;
          border: 1px solid rgba(255,255,255,0.1);
          box-shadow: 0 20px 40px rgba(0,0,0,0.3);
        }

        .mps-hero-content {
          display: flex;
          align-items: center;
          justify-content: space-between;
          gap: 2rem;
        }

        .mps-hero-text h1 {
          font-size: 2.5rem;
          font-weight: 800;
          margin: 0 0 0.5rem 0;
          background: linear-gradient(135deg, #fff 0%, #fbbf24 100%);
          -webkit-background-clip: text;
          -webkit-text-fill-color: transparent;
        }

        .mps-hero-text p {
          font-size: 1.1rem;
          opacity: 0.9;
          margin: 0;
          color: #cbd5e1;
        }

        .mps-hero-stats {
          display: flex;
          gap: 1rem;
          flex-shrink: 0;
        }

        .mps-stat {
          background: rgba(255,255,255,0.05);
          border: 1px solid rgba(255,255,255,0.1);
          border-radius: 12px;
          padding: 1rem 1.5rem;
          text-align: center;
          min-width: 120px;
        }

        .mps-stat-number {
          font-size: 1.5rem;
          font-weight: 800;
          color: #fbbf24;
          display: block;
        }

        .mps-stat-label {
          font-size: 0.875rem;
          opacity: 0.8;
          margin-top: 0.25rem;
        }

        /* Filtros rediseñados */
        .mps-filters {
          display: flex;
          gap: 0.5rem;
          background: rgba(255,255,255,0.05);
          padding: 0.5rem;
          border-radius: 16px;
          margin-bottom: 2rem;
          border: 1px solid rgba(255,255,255,0.1);
        }

        .mps-filter {
          padding: 0.75rem 1.5rem;
          border: none;
          border-radius: 12px;
          background: transparent;
          color: #cbd5e1;
          font-weight: 600;
          cursor: pointer;
          transition: all 0.3s ease;
        }

        .mps-filter.active {
          background: linear-gradient(135deg, #f59e0b 0%, #d97706 100%);
          color: white;
          box-shadow: 0 4px 12px rgba(245, 158, 11, 0.3);
        }

        .mps-filter:hover:not(.active) {
          background: rgba(255,255,255,0.1);
          color: white;
        }

        /* Grid de pedidos rediseñado */
        .mps-grid {
          display: grid;
          grid-template-columns: repeat(auto-fill, minmax(400px, 1fr));
          gap: 1.5rem;
        }

        .mps-card {
          background: linear-gradient(135deg, rgba(255,255,255,0.05) 0%, rgba(255,255,255,0.02) 100%);
          border: 1px solid rgba(255,255,255,0.1);
          border-radius: 20px;
          padding: 1.5rem;
          transition: all 0.3s ease;
          backdrop-filter: blur(10px);
          position: relative;
          overflow: hidden;
        }

        .mps-card:hover {
          transform: translateY(-5px);
          border-color: rgba(245, 158, 11, 0.3);
          box-shadow: 0 20px 40px rgba(0,0,0,0.4);
        }

        .mps-card-header {
          display: flex;
          align-items: center;
          justify-content: space-between;
          margin-bottom: 1rem;
          padding-bottom: 1rem;
          border-bottom: 1px solid rgba(255,255,255,0.1);
        }

        .mps-card-title {
          font-size: 1.25rem;
          font-weight: 700;
          color: white;
          margin: 0;
        }

        .mps-estado {
          padding: 0.5rem 1rem;
          border-radius: 20px;
          font-size: 0.75rem;
          font-weight: 700;
          text-transform: uppercase;
          letter-spacing: 0.5px;
        }

        .mps-card-body {
          display: grid;
          gap: 1rem;
        }

        .mps-info-grid {
          display: grid;
          grid-template-columns: 1fr 1fr;
          gap: 1rem;
        }

        .mps-info-item {
          display: flex;
          flex-direction: column;
          gap: 0.25rem;
        }

        .mps-info-label {
          font-size: 0.875rem;
          opacity: 0.7;
          color: #cbd5e1;
        }

        .mps-info-value {
          font-size: 1rem;
          font-weight: 600;
          color: white;
        }

        .mps-total {
          font-size: 1.25rem;
          font-weight: 800;
          color: #fbbf24;
          text-align: center;
          padding: 1rem 0;
          border-top: 1px solid rgba(255,255,255,0.1);
          margin-top: 0.5rem;
        }

        .mps-card-actions {
          display: flex;
          gap: 0.75rem;
          margin-top: 1rem;
        }

        .mps-btn {
          flex: 1;
          padding: 0.75rem 1.5rem;
          border: none;
          border-radius: 12px;
          font-weight: 600;
          cursor: pointer;
          transition: all 0.3s ease;
          display: flex;
          align-items: center;
          justify-content: center;
          gap: 0.5rem;
        }

        .mps-btn-primary {
          background: linear-gradient(135deg, #3b82f6 0%, #1d4ed8 100%);
          color: white;
        }

        .mps-btn-primary:hover {
          transform: translateY(-2px);
          box-shadow: 0 8px 20px rgba(59, 130, 246, 0.4);
        }

        .mps-btn-danger {
          background: rgba(239, 68, 68, 0.2);
          border: 1px solid rgba(239, 68, 68, 0.3);
          color: #ef4444;
        }

        .mps-btn-danger:hover {
          background: rgba(239, 68, 68, 0.3);
          transform: translateY(-2px);
        }

        /* Estados vacíos */
        .mps-empty-state {
          text-align: center;
          padding: 4rem 2rem;
          color: #64748b;
          grid-column: 1 / -1;
        }

        .mps-empty-icon {
          font-size: 4rem;
          margin-bottom: 1rem;
          opacity: 0.5;
        }

        .mps-empty-text {
          font-size: 1.125rem;
          margin-bottom: 1.5rem;
        }

        /* Loading state */
        .mps-loading {
          display: flex;
          justify-content: center;
          align-items: center;
          padding: 4rem;
          color: #64748b;
          grid-column: 1 / -1;
        }

        /* Responsive */
        @media (max-width: 1024px) {
          .mps-hero-content {
            flex-direction: column;
            text-align: center;
          }
          
          .mps-hero-stats {
            justify-content: center;
          }
          
          .mps-grid {
            grid-template-columns: 1fr;
          }
        }

        @media (max-width: 480px) {
          .mps-info-grid {
            grid-template-columns: 1fr;
          }
          
          .mps-card-actions {
            flex-direction: column;
          }
        }

        /* Toast mejorado */
        .mps-toast-wrap { 
          position: fixed; 
          top: 20px; 
          left: 50%; 
          transform: translateX(-50%);
          z-index: 10000; 
          pointer-events: none; 
        }
        
        .mps-toast { 
          pointer-events: auto; 
          background: linear-gradient(135deg, #059669 0%, #047857 100%);
          color: white; 
          padding: 1rem 1.5rem; 
          border-radius: 12px; 
          box-shadow: 0 10px 30px rgba(0,0,0,0.4);
          border: 1px solid rgba(255,255,255,0.2);
          display: flex;
          align-items: center;
          gap: 0.75rem;
        }

        /* Confirm modal mejorado */
        .mps-backdrop {
          position: fixed; 
          inset: 0; 
          display: grid; 
          place-items: center;
          background: rgba(0,0,0,0.8);
          backdrop-filter: blur(8px);
          z-index: 10000;
          animation: mpsFade .18s ease-out;
        }
        
        @keyframes mpsFade { from { opacity: 0 } to { opacity: 1 } }
        
        .mps-dialog {
          width: min(480px, 92vw);
          border-radius: 20px;
          overflow: hidden;
          background: linear-gradient(135deg, #1e293b 0%, #0f172a 100%);
          border: 1px solid rgba(255,255,255,0.1);
          box-shadow: 0 32px 64px rgba(0,0,0,0.5);
        }
        
        .mps-dialog-head { 
          padding: 1.5rem; 
          border-bottom: 1px solid rgba(255,255,255,0.1); 
          background: linear-gradient(135deg, rgba(255,255,255,0.05) 0%, transparent 100%);
        }
        
        .mps-dialog-title { 
          margin: 0; 
          font-size: 1.25rem; 
          font-weight: 700; 
          color: white;
          display: flex;
          align-items: center;
          gap: 0.5rem;
        }
        
        .mps-dialog-body { 
          padding: 1.5rem; 
        }
        
        .mps-dialog-actions { 
          display: flex; 
          justify-content: flex-end; 
          gap: 1rem; 
          padding: 1.5rem; 
          border-top: 1px solid rgba(255,255,255,0.1); 
        }
      `}</style>

      {/* Toast de "Pedido eliminado" */}
      {toast?.msg && (
        <div className="mps-toast-wrap">
          <div className="mps-toast">
            <span>✅</span>
            {toast.msg}
          </div>
        </div>
      )}

      {/* Modal de confirmación */}
      {confirmBox && (
        <div className="mps-backdrop" role="dialog" aria-modal="true" onClick={cerrarConfirm}>
          <div className="mps-dialog" onClick={(e) => e.stopPropagation()}>
            <div className="mps-dialog-head">
              <h3 className="mps-dialog-title">🗑️ {confirmBox.titulo}</h3>
            </div>
            <div className="mps-dialog-body">
              <p style={{ margin: 0, color: '#cbd5e1', fontSize: '1rem' }}>{confirmBox.mensaje}</p>
            </div>
            <div className="mps-dialog-actions">
              <button className="wc-btn wc-btn-ghost" onClick={cerrarConfirm}>
                No, volver
              </button>
              <button className="wc-btn wc-btn-primary" onClick={confirmarCancelacion}>
                Sí, cancelar
              </button>
            </div>
          </div>
        </div>
      )}

      <section className="wc-section">
        <div className="wc-container">
          {/* Hero Section */}
          <div className="mps-hero">
            <div className="mps-hero-content">
              <div className="mps-hero-text">
                <h1>📒 Mis Pedidos de Snacks</h1>
                <p>Revisa el estado y vuelve a abrir tu comprobante</p>
              </div>
              <div className="mps-hero-stats">
                <div className="mps-stat">
                  <span className="mps-stat-number">{items.length}</span>
                  <span className="mps-stat-label">Total</span>
                </div>
                <button className="wc-btn wc-btn-primary" onClick={() => navigate("/snacks")}>
                  🛒 Realizar Pedido
                </button>
                <button className="wc-btn wc-btn-ghost" onClick={load}>
                  🔄 Actualizar
                </button>
              </div>
            </div>
          </div>

          {/* Filtros de estado */}
          <div className="mps-filters">
            {[
              ["TODOS", "🎯 Todos"],
              ["PENDIENTE", "⏳ Pendientes"],
              ["ACEPTADO", "✅ Aceptados"],
              ["ENTREGADO", "📦 Entregados"],
            ].map(([key, label]) => (
              <button
                key={key}
                className={`mps-filter ${filtro === key ? "active" : ""}`}
                onClick={() => setFiltro(key)}
              >
                {label}
              </button>
            ))}
          </div>

          {/* Grid de pedidos */}
          <div className="mps-grid">
            {loading ? (
              <div className="mps-loading">
                <div>Cargando pedidos...</div>
              </div>
            ) : visibles.length === 0 ? (
              <div className="mps-empty-state">
                <div className="mps-empty-icon">📦</div>
                <div className="mps-empty-text">
                  {filtro === "TODOS" 
                    ? "Aún no tienes pedidos de snacks" 
                    : `No hay pedidos ${filtro.toLowerCase()}`
                  }
                </div>
                {filtro !== "TODOS" && (
                  <button 
                    className="wc-btn wc-btn-primary" 
                    onClick={() => setFiltro("TODOS")}
                  >
                    Ver todos los pedidos
                  </button>
                )}
              </div>
            ) : (
              visibles.map((p) => {
                const estadoStyles = getEstadoStyles(p.estado);
                return (
                  <article key={`${p.id ?? Math.random()}`} className="mps-card">
                    <div className="mps-card-header">
                      <h3 className="mps-card-title">Pedido #{p.id ?? "—"}</h3>
                      <div 
                        className="mps-estado"
                        style={estadoStyles}
                      >
                        {p.estado}
                      </div>
                    </div>

                    <div className="mps-card-body">
                      <div className="mps-info-grid">
                        <div className="mps-info-item">
                          <span className="mps-info-label">Sala</span>
                          <span className="mps-info-value">
                            {salaDisplay(p.salaNombre, p.salaId)}
                          </span>
                        </div>
                        <div className="mps-info-item">
                          <span className="mps-info-label">Asiento</span>
                          <span className="mps-info-value">{p.asiento ?? "—"}</span>
                        </div>
                        <div className="mps-info-item">
                          <span className="mps-info-label">Fecha</span>
                          <span className="mps-info-value">
                            {p.creado ? String(p.creado).replace("T", " ").slice(0, 16) : "—"}
                          </span>
                        </div>
                        <div className="mps-info-item">
                          <span className="mps-info-label">Efectivo</span>
                          <span className="mps-info-value">{fmtQ(p.efectivo)}</span>
                        </div>
                      </div>

                      <div className="mps-total">
                        Total: {fmtQ(p.total)}
                      </div>

                      <div className="mps-card-actions">
                        <button 
                          className="mps-btn mps-btn-primary" 
                          onClick={() => openPdf(p.id)}
                        >
                          📄 Ver PDF
                        </button>
                        {String(p.estado).toUpperCase() === "PENDIENTE" && (
                          <button 
                            className="mps-btn mps-btn-danger" 
                            onClick={() => pedirConfirmacionCancel(p)}
                          >
                            🗑️ Cancelar
                          </button>
                        )}
                      </div>
                    </div>
                  </article>
                );
              })
            )}
          </div>
        </div>
      </section>
    </main>
  );
}