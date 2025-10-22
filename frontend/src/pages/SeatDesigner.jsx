// src/pages/SeatDesigner.jsx
import React, { useEffect, useMemo, useRef, useState } from "react";
import axios from "axios";
import { useParams, useNavigate } from "react-router-dom";
import { toast } from "react-toastify";

const API_BASE = import.meta.env?.VITE_API_BASE_URL || "http://localhost:3001";

const TOOL_VACIO     = 0;
const TOOL_NORMAL    = 1;
const TOOL_PMR       = 2;
const TOOL_DISABLED  = -1;

const tools = [
  { key: TOOL_NORMAL,   label: "Normal",        bg: "#60a5fa", fg: "#fff", icon: "fa-chair" },
  { key: TOOL_PMR,      label: "PMR",           bg: "#111827", fg: "#fff", icon: "fa-wheelchair" },
  { key: TOOL_DISABLED, label: "Deshabilitado", bg: "#ef4444", fg: "#fff", icon: "fa-ban" },
  { key: TOOL_VACIO,    label: "Vacío",         bg: "#f3f4f6", fg: "#111", icon: "fa-times" },
];

export default function SeatDesigner() {
  const { id } = useParams();
  const navigate = useNavigate();

  const [loading, setLoading] = useState(true);
  const [saving, setSaving]   = useState(false);
  const [sala, setSala]       = useState(null);
  const [locked, setLocked]   = useState(false);

  const [rows, setRows] = useState(10);
  const [cols, setCols] = useState(15);
  const [firstRow, setFirstRow] = useState("A");
  const [grid, setGrid] = useState(() => Array.from({ length: 10 }, () => Array(15).fill(0)));
  const [tool, setTool] = useState(TOOL_NORMAL);

  const gridWrapRef = useRef(null);
  const [seatPx, setSeatPx] = useState(35);

  // ===== Fondo global blanco SOLO mientras esta vista está montada
  useEffect(() => {
    const prevHtml = document.documentElement.style.background;
    const prevBody = document.body.style.background;
    const white = getComputedStyle(document.documentElement).getPropertyValue('--color-fondo')?.trim() || '#ffffff';
    document.documentElement.style.background = white;
    document.body.style.background = white;
    return () => {
      document.documentElement.style.background = prevHtml;
      document.body.style.background = prevBody;
    };
  }, []);

  // ===== Cálculo responsivo (tu lógica, sin cambios funcionales)
  useEffect(() => {
    if (!gridWrapRef.current) return;

    const calculateSeatSize = () => {
      const container = gridWrapRef.current;
      const availableWidth = container.clientWidth - 80;
      const availableHeight = window.innerHeight - 300;

      const widthBasedSize = Math.floor((availableWidth - 50) / (cols + 1));
      const heightBasedSize = Math.floor((availableHeight - 50) / (rows + 2));
      const calculatedSize = Math.min(widthBasedSize, heightBasedSize);
      const clampedSize = Math.max(25, Math.min(45, calculatedSize));
      return clampedSize;
    };

    const onResize = () => setSeatPx(calculateSeatSize());

    const ro = new ResizeObserver(onResize);
    ro.observe(gridWrapRef.current);
    window.addEventListener('resize', onResize);

    // primer cálculo
    onResize();

    return () => {
      ro.disconnect();
      window.removeEventListener('resize', onResize);
    };
  }, [cols, rows]);

  const paintRef = useRef({ active: false });
  const API = (path, cfg) => axios({ url: `${API_BASE}${path}`, ...cfg });

  useEffect(() => {
    (async () => {
      try {
        setLoading(true);
        try {
          const s = await API(`/api/salas`);
          const salaEncontrada = (s.data || []).find(x => Number(x.id) === Number(id)) || null;
          setSala(salaEncontrada);
          setLocked(Boolean(salaEncontrada?.funcionesActivas > 0));
        } catch {}
        const { data } = await API(`/api/salas/${id}/asientos`, { method: 'GET' });
        if (Array.isArray(data) && data.length) {
          const letras = [...new Set(data.map(x => (x.fila || x.FILA))).values()].sort();
          const minLetter = letras[0];
          const maxLetter = letras[letras.length - 1];
          const maxCol = Math.max(...data.map(x => Number(x.columna || x.COLUMNA || 0)));
          const r = (maxLetter.charCodeAt(0) - minLetter.charCodeAt(0)) + 1;
          const c = maxCol;
          setRows(r); setCols(c); setFirstRow(minLetter);
          const g = Array.from({ length: r }, () => Array(c).fill(0));
          data.forEach(x => {
            const fila = String(x.fila || x.FILA);
            const col  = Number(x.columna || x.COLUMNA);
            const tipo = String(x.tipo || x.TIPO || "NORMAL");
            const activo = String(x.activo || x.ACTIVO || "S");
            const rr = fila.charCodeAt(0) - minLetter.charCodeAt(0);
            const cc = col - 1;
            if (activo === "S") g[rr][cc] = (tipo === "PMR" ? TOOL_PMR : TOOL_NORMAL);
            else if (tipo === "DISABLED") g[rr][cc] = TOOL_DISABLED;
          });
          setGrid(g);
        }
      } catch {
        toast.error("No se pudieron cargar los asientos de la sala");
      } finally {
        setLoading(false);
      }
    })();
  }, [id]);

  const activos = useMemo(() => grid.flat().filter(v => v === TOOL_NORMAL || v === TOOL_PMR).length, [grid]);
  const deshab  = useMemo(() => grid.flat().filter(v => v === TOOL_DISABLED).length, [grid]);

  const addRow = (where = 'end') => setGrid(g => {
    const copy = g.map(r => [...r]);
    const empty = Array(cols).fill(0);
    if (where === 'start') copy.unshift(empty); else copy.push(empty);
    setRows(copy.length);
    return copy;
  });
  const addCol = (where = 'end') => setGrid(g => {
    const copy = g.map(r => where === 'start' ? [0, ...r] : [...r, 0]);
    setCols(copy[0].length);
    return copy;
  });
  const removeRow = (where = 'end') => setGrid(g => {
    if (g.length <= 1) return g;
    const copy = g.map(r => [...r]);
    if (where === 'start') copy.shift(); else copy.pop();
    setRows(copy.length);
    return copy;
  });
  const removeCol = (where = 'end') => setGrid(g => {
    if (g[0].length <= 1) return g;
    const copy = g.map(r => where === 'start' ? r.slice(1) : r.slice(0, -1));
    setCols(copy[0].length);
    return copy;
  });

  const applyTool = (r, c, t = tool) => setGrid(g => {
    const copy = g.map(row => [...row]);
    copy[r][c] = t;
    return copy;
  });

  const cycleTool = (v) => {
    const order = [TOOL_VACIO, TOOL_NORMAL, TOOL_PMR, TOOL_DISABLED];
    const i = order.indexOf(v);
    return order[(i + 1) % order.length];
  };

  const onMouseDown = (r, c, e) => {
    if (locked) return;
    e.preventDefault();
    paintRef.current.active = true;
    applyTool(r, c, e.shiftKey ? cycleTool(grid[r][c]) : tool);
  };
  const onMouseEnter = (r, c) => {
    if (locked) return;
    if (paintRef.current.active) applyTool(r, c);
  };
  const onMouseUp = () => { paintRef.current.active = false; };

  const save = async () => {
    try {
      setSaving(true);
      const payload = { primeraFila: firstRow, grid };
      const { data } = await API(`/api/salas/${id}/asientos/replace`, { method: 'POST', data: payload });
      toast.success(`Mapa guardado. Activos: ${data?.activos ?? 0}`);
      navigate('/dashboard/salas');
    } catch (e) {
      toast.error(e?.response?.data?.message || "No se pudo guardar el mapa");
    } finally { setSaving(false); }
  };

  const seatClass = (v) => {
    switch (v) {
      case TOOL_NORMAL:   return "seat seat--normal";
      case TOOL_PMR:      return "seat seat--pmr";
      case TOOL_DISABLED: return "seat seat--disabled";
      default:            return "seat seat--empty";
    }
  };
  const letter = (i) => String.fromCharCode(firstRow.charCodeAt(0) + i);

  if (loading) return (
    <div className="loading-container">
      <div className="loading-spinner"></div>
      <p>Cargando editor…</p>
    </div>
  );

  return (
    <div className="seat-designer-dashboard" onMouseUp={onMouseUp}>
      <style>{`
        /* ====== Fondo global claro solo en esta vista ====== */
        :root { --app-bg: var(--color-fondo, #ffffff); }
        html, body, #root, .dashboard-container { background: var(--app-bg) !important; }

        .seat-designer-dashboard {
          position: relative;
          min-height: 100vh;
          background: var(--app-bg);
          padding: 0;
          overflow: hidden;
        }
        /* Fondo de seguridad que cubre cualquier gradiente del layout */
        .seat-designer-dashboard::before {
          content: "";
          position: fixed;
          inset: 0;
          background: var(--app-bg);
          z-index: 0;
          pointer-events: none;
        }
        .designer-root { position: relative; z-index: 1; }

        /* ====== (Tu CSS existente) ====== */
        .loading-container {
          display: flex; flex-direction: column; align-items: center; justify-content: center;
          height: 400px; color: #64748b;
        }
        .loading-spinner {
          width: 40px; height: 40px; border: 4px solid #e2e8f0; border-top: 4px solid #3b82f6;
          border-radius: 50%; animation: spin 1s linear infinite; margin-bottom: 16px;
        }
        @keyframes spin { 0%{transform:rotate(0)} 100%{transform:rotate(360deg)} }

        .designer-header { background:#fff; border-bottom:1px solid #e5e7eb; padding:16px 24px; box-shadow:0 1px 2px rgba(0,0,0,.05); }
        .header-content { display:flex; justify-content:space-between; align-items:center; max-width:100%; margin:0 auto; }
        .header-left { display:flex; align-items:center; gap:20px; }
        .header-title h1 { margin:0; font-size:1.5rem; font-weight:700; color:#111827; }
        .header-title p { margin:4px 0 0; color:#6b7280; font-size:.9rem; }
        .header-stats { display:flex; gap:12px; }
        .stat-item { display:flex; flex-direction:column; align-items:center; padding:8px 16px; background:#f9fafb; border-radius:8px; border:1px solid #e5e7eb; min-width:80px; }
        .stat-value { font-size:1.1rem; font-weight:700; color:#111827; }
        .stat-label { font-size:.8rem; color:#6b7280; margin-top:2px; }
        .header-actions { display:flex; gap:10px; }

        .designer-main { height: calc(100vh - 120px); display:grid; grid-template-columns:280px 1fr; gap:0; background:#fff; }
        .designer-sidebar { background:#fff; border-right:1px solid #e5e7eb; padding:20px; overflow-y:auto; height:100%; }
        .sidebar-section { margin-bottom:24px; } .sidebar-section:last-child{ margin-bottom:0; }
        .section-title { font-size:.95rem; font-weight:600; color:#111827; margin-bottom:12px; padding-bottom:8px; border-bottom:1px solid #f3f4f6; }
        .tools-grid { display:flex; flex-direction:column; gap:6px; }
        .tool-btn { display:flex; align-items:center; gap:10px; padding:10px 12px; border:1px solid #e5e7eb; border-radius:8px; background:#fff; cursor:pointer; transition:.2s; font-weight:500; color:#374151; font-size:.9rem; }
        .tool-btn:hover { border-color:#3b82f6; background:#f8fafc; }
        .tool-btn.active { border-color:#3b82f6; background:#3b82f6; color:#fff; }
        .tool-btn:disabled { opacity:.5; cursor:not-allowed; }
        .tool-indicator { width:14px; height:14px; border-radius:3px; flex-shrink:0; }

        .controls-grid { display:flex; flex-direction:column; gap:12px; }
        .control-group { display:flex; flex-direction:column; gap:6px; }
        .control-label { font-size:.85rem; font-weight:600; color:#374151; }
        .first-row-input { display:flex; gap:6px; }
        .first-row-input input { flex:1; padding:6px 8px; border:1px solid #d1d5db; border-radius:6px; text-align:center; font-weight:600; font-size:.9rem; background:#fff; }

        .grid-buttons { display:grid; grid-template-columns:1fr 1fr; gap:6px; }
        .grid-btn { padding:6px 8px; border:1px solid #d1d5db; border-radius:6px; background:#fff; cursor:pointer; transition:.2s; font-size:.8rem; font-weight:500; }
        .grid-btn:hover:not(:disabled){ background:#3b82f6; color:#fff; border-color:#3b82f6; }
        .grid-btn:disabled{ opacity:.5; cursor:not-allowed; }

        .action-buttons { display:flex; flex-direction:column; gap:10px; }
        .action-btn { padding:10px 12px; border:none; border-radius:8px; font-weight:600; cursor:pointer; transition:.2s; display:flex; align-items:center; justify-content:center; gap:6px; font-size:.9rem; }
        .btn-cancel { background:#6b7280; color:#fff; } .btn-cancel:hover{ background:#4b5563; }
        .btn-save { background:#059669; color:#fff; } .btn-save:hover:not(:disabled){ background:#047857; } .btn-save:disabled{ background:#9ca3af; cursor:not-allowed; }

        .designer-canvas { background:#fff; padding:20px; height:100%; display:flex; flex-direction:column; }
        .canvas-container { flex:1; background:#f9fafb; border-radius:8px; border:1px solid #e5e7eb; display:flex; align-items:center; justify-content:center; padding:20px; overflow:auto; max-height:100%; }
        .grid-wrapper { display:flex; flex-direction:column; align-items:center; gap:20px; }
        .seat-grid { display:grid; grid-template-columns:40px repeat(var(--cols), var(--seat-size)); gap:6px; }
        .grid-header, .row-label { color:#6b7280; font-size:.8rem; font-weight:600; display:flex; align-items:center; justify-content:center; }
        .row-label { justify-content:flex-end; padding-right:8px; }

        .seat { width:var(--seat-size); height:var(--seat-size); border-radius:6px; border:1px solid; display:flex; align-items:center; justify-content:center; cursor:pointer; transition:.15s; font-size:.7rem; }
        .seat:hover { transform:scale(1.05); box-shadow:0 2px 6px rgba(0,0,0,.1); }
        .seat--normal{ background:#3b82f6; border-color:#2563eb; color:#fff; }
        .seat--pmr{ background:#111827; border-color:#030712; color:#fff; }
        .seat--disabled{ background:#ef4444; border-color:#dc2626; color:#fff; }
        .seat--empty{ background:#f3f4f6; border-color:#d1d5db; color:#6b7280; }

        .screen-section{ width:100%; display:flex; flex-direction:column; align-items:center; gap:8px; }
        .screen-label{ color:#6b7280; font-weight:600; font-size:.9rem; }
        .screen{ height:12px; background:#374151; border-radius:6px; width: calc(40px + (var(--cols) * var(--seat-size)) + (var(--cols) * 6px)); box-shadow:0 2px 4px rgba(0,0,0,.1); }

        .tips-section{ margin-top:15px; padding:12px; background:#f0f9ff; border-radius:6px; border:1px solid #e0f2fe; }
        .tips-text{ color:#0369a1; font-size:.8rem; margin:0; text-align:center; line-height:1.4; }

        .lock-alert{ background:#fffbeb; border:1px solid #fcd34d; color:#92400e; padding:12px 16px; border-radius:8px; margin:0 24px 16px; display:flex; align-items:center; gap:10px; }
        .lock-alert i{ color:#d97706; }

        @media (max-width:1024px){ .designer-main{ grid-template-columns:250px 1fr; } .designer-sidebar{ padding:16px; } }
        @media (max-width:768px){
          .designer-main{ grid-template-columns:1fr; height:auto; min-height:calc(100vh - 120px); }
          .designer-sidebar{ order:2; border-right:none; border-top:1px solid #e5e7eb; height:auto; }
          .designer-canvas{ order:1; height:60vh; }
          .header-content{ flex-direction:column; gap:12px; align-items:flex-start; }
          .header-stats{ width:100%; justify-content:space-around; }
        }
      `}</style>

      {/* Contenido real sobre el fondo fijo */}
      <div className="designer-root">
        {/* Header */}
        <div className="designer-header">
          <div className="header-content">
            <div className="header-left">
              <div className="header-title">
                <h1>Editor de Asientos — {sala?.nombre || `Sala ${id}`}</h1>
                <p>Diseña la distribución de asientos</p>
              </div>
              <div className="header-stats">
                <div className="stat-item">
                  <div className="stat-value">{rows}×{cols}</div>
                  <div className="stat-label">Tamaño</div>
                </div>
                <div className="stat-item">
                  <div className="stat-value">{activos}</div>
                  <div className="stat-label">Activos</div>
                </div>
                <div className="stat-item">
                  <div className="stat-value">{deshab}</div>
                  <div className="stat-label">Deshab.</div>
                </div>
              </div>
            </div>
            <div className="header-actions">
              <button className="action-btn btn-cancel" onClick={() => navigate('/dashboard/salas')}>
                <i className="fas fa-arrow-left"></i> Volver
              </button>
            </div>
          </div>
        </div>

        {locked && (
          <div className="lock-alert">
            <i className="fas fa-lock"></i>
            <div>
              <strong>Sala bloqueada</strong>
              <p className="m-0">No se puede editar - hay funciones activas</p>
            </div>
          </div>
        )}

        {/* Main */}
        <div className="designer-main">
          {/* Sidebar */}
          <div className="designer-sidebar">
            <div className="sidebar-section">
              <h3 className="section-title">Herramientas</h3>
              <div className="tools-grid">
                {tools.map(t => (
                  <button
                    key={t.key}
                    className={`tool-btn ${tool === t.key ? 'active' : ''}`}
                    onClick={() => setTool(t.key)}
                    disabled={locked}
                  >
                    <span className="tool-indicator" style={{ background: t.bg }} />
                    <i className={`fas ${t.icon}`}></i>
                    {t.label}
                  </button>
                ))}
              </div>
            </div>

            <div className="sidebar-section">
              <h3 className="section-title">Controles</h3>
              <div className="controls-grid">
                <div className="control-group">
                  <label className="control-label">Primera Fila</label>
                  <div className="first-row-input">
                    <input
                      value={firstRow}
                      maxLength={1}
                      onChange={(e) => setFirstRow((e.target.value || 'A').toUpperCase().slice(0, 1))}
                      disabled={locked}
                    />
                  </div>
                </div>

                <div className="control-group">
                  <label className="control-label">Filas</label>
                  <div className="grid-buttons">
                    <button className="grid-btn" onClick={() => addRow('start')} disabled={locked}>+ Arriba</button>
                    <button className="grid-btn" onClick={() => addRow('end')} disabled={locked}>+ Abajo</button>
                    <button className="grid-btn" onClick={() => removeRow('start')} disabled={locked}>- Arriba</button>
                    <button className="grid-btn" onClick={() => removeRow('end')} disabled={locked}>- Abajo</button>
                  </div>
                </div>

                <div className="control-group">
                  <label className="control-label">Columnas</label>
                  <div className="grid-buttons">
                    <button className="grid-btn" onClick={() => addCol('start')} disabled={locked}>+ Izq</button>
                    <button className="grid-btn" onClick={() => addCol('end')} disabled={locked}>+ Der</button>
                    <button className="grid-btn" onClick={() => removeCol('start')} disabled={locked}>- Izq</button>
                    <button className="grid-btn" onClick={() => removeCol('end')} disabled={locked}>- Der</button>
                  </div>
                </div>
              </div>
            </div>

            <div className="sidebar-section">
              <h3 className="section-title">Acciones</h3>
              <div className="action-buttons">
                <button className="action-btn btn-save" disabled={saving || locked} onClick={save}>
                  {saving ? (<><i className="fas fa-spinner fa-spin"></i> Guardando...</>) : (<><i className="fas fa-save"></i> Guardar Mapa</>)}
                </button>
              </div>
            </div>
          </div>

          {/* Canvas */}
          <div className="designer-canvas">
            <div className="canvas-container" style={locked ? { pointerEvents: 'none', opacity: 0.6 } : {}}>
              <div
                ref={gridWrapRef}
                className="grid-wrapper"
                style={{ '--cols': cols, '--seat-size': `${seatPx}px` }}
              >
                <div className="seat-grid">
                  <div></div>
                  {Array.from({ length: cols }).map((_, c) => (
                    <div key={`ch-${c}`} className="grid-header">{c + 1}</div>
                  ))}
                  {Array.from({ length: rows }).map((_, r) => (
                    <React.Fragment key={`r-${r}`}>
                      <div className="row-label">{letter(r)}</div>
                      {Array.from({ length: cols }).map((_, c) => {
                        const v = grid[r][c];
                        return (
                          <button
                            key={`cell-${r}-${c}`}
                            type="button"
                            className={seatClass(v)}
                            onMouseDown={(e) => onMouseDown(r, c, e)}
                            onMouseEnter={(e) => onMouseEnter(r, c, e)}
                            title={`${letter(r)}-${c + 1}${v === TOOL_PMR ? ' (PMR)' : ''}`}
                          >
                            {v === TOOL_PMR ? <i className="fas fa-wheelchair"></i>
                              : v === TOOL_VACIO ? <i className="fas fa-times"></i>
                              : <i className="fas fa-chair"></i>}
                          </button>
                        );
                      })}
                    </React.Fragment>
                  ))}
                </div>

                <div className="screen-section">
                  <div className="screen-label">PANTALLA</div>
                  <div className="screen"></div>
                </div>
              </div>
            </div>

            <div className="tips-section">
              <p className="tips-text">
                <strong>Consejos:</strong> Clic para pintar • Shift+Clic para alternar tipos •
                Arrastra para pintar rápido • "Vacío" para pasillos
              </p>
            </div>
          </div>
        </div>
      </div>
    </div>
  );
}
