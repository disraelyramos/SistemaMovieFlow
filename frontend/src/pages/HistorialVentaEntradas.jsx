import React, { useEffect, useMemo, useState } from 'react';
import axios from 'axios';
import '../styles/historial.css';

const API_BASE = import.meta.env?.VITE_API_BASE_URL || 'http://localhost:3001';
const get = (p, cfg = {}) => axios.get(`${API_BASE}${p}`, cfg);

const currency = (v = 0) =>
  Number(v || 0).toLocaleString('es-GT', {
    style: 'currency', currency: 'GTQ', minimumFractionDigits: 2,
  });

// ---- Fechas ----
const parseFechaLocal = (v) => {
  const m = /^(\d{4})-(\d{2})-(\d{2})$/.exec(v || '');
  if (m) return new Date(+m[1], +m[2] - 1, +m[3]);
  const d = new Date(v);
  return Number.isNaN(d.getTime()) ? null : d;
};
const diasAbbr = ['Dom', 'Lun', 'Mar', 'Miér', 'Jue', 'Vie', 'Sáb'];
const pad2 = (n) => String(n).padStart(2, '0');
const fechaLarga = (yyyy_mm_dd) => {
  const d = parseFechaLocal(yyyy_mm_dd);
  if (!d) return '—';
  return `${diasAbbr[d.getDay()]} ${pad2(d.getDate())}/${pad2(d.getMonth() + 1)}/${d.getFullYear()}`;
};

const parseFechaHoraLocal = (v) => {
  const m = /^(\d{4})-(\d{2})-(\d{2})[ T](\d{2}):(\d{2})$/.exec(v || '');
  if (m) return new Date(+m[1], +m[2] - 1, +m[3], +m[4], +m[5], 0);
  const d = new Date(v);
  return Number.isNaN(d.getTime()) ? null : d;
};
const fechaHoraCorta = (yyyy_mm_dd_hhmm) => {
  const d = parseFechaHoraLocal(yyyy_mm_dd_hhmm);
  if (!d) return '—';
  return `${pad2(d.getDate())}/${pad2(d.getMonth() + 1)}/${d.getFullYear()} ${pad2(d.getHours())}:${pad2(d.getMinutes())}`;
};

export default function HistorialVentasEntradas() {
  const [rows, setRows] = useState([]);
  const [loading, setLoading] = useState(false);

  const [peliculas, setPeliculas] = useState([]);
  const [salas, setSalas] = useState([]);
  const [metodos, setMetodos] = useState([]);
  const [funciones, setFunciones] = useState([]);

  const [peliculaId, setPeliculaId] = useState('ALL');
  const [salaId, setSalaId] = useState('ALL');
  const [metodo, setMetodo] = useState('ALL');
  const [funcionId, setFuncionId] = useState('ALL');

  // Modal para ver asientos
  const [modalOpen, setModalOpen] = useState(false);
  const [selectedAsientos, setSelectedAsientos] = useState('');

  const fetchOpciones = async () => {
    const { data } = await get('/api/admin/historial/opciones');
    setPeliculas(data?.peliculas || []);
    setSalas(data?.salas || []);
    // Filtrar para mostrar solo EFECTIVO
    const metodosFiltrados = (data?.metodosPago || []).filter(m => m === 'EFECTIVO');
    setMetodos(metodosFiltrados);
  };
  
  const fetchFunciones = async () => {
    const params = {};
    if (peliculaId !== 'ALL') params.peliculaId = Number(peliculaId);
    if (salaId !== 'ALL') params.salaId = Number(salaId);
    const { data } = await get('/api/admin/historial/funciones', { params });
    setFunciones(Array.isArray(data) ? data : []);
  };
  
  const fetchTabla = async () => {
    setLoading(true);
    try {
      const params = {};
      if (peliculaId !== 'ALL') params.peliculaId = Number(peliculaId);
      if (salaId !== 'ALL') params.salaId = Number(salaId);
      if (metodo !== 'ALL') params.metodoPago = metodo;
      if (funcionId !== 'ALL') params.funcionId = Number(funcionId);
      const { data } = await get('/api/admin/historial/ventas', { params });
      setRows(Array.isArray(data) ? data : []);
    } catch {
      setRows([]);
    } finally {
      setLoading(false);
    }
  };

  useEffect(() => {
    (async () => {
      await fetchOpciones();
      await fetchFunciones();
      await fetchTabla();
    })();
  }, []);

  // Al cambiar película o sala, reinicia función y recarga opciones
  useEffect(() => {
    setFuncionId('ALL');
    fetchFunciones();
  }, [peliculaId, salaId]);

  // La tabla se actualiza automáticamente al cambiar cualquier filtro
  useEffect(() => {
    fetchTabla();
  }, [peliculaId, salaId, metodo, funcionId]);

  const vacio = useMemo(() => !loading && rows.length === 0, [loading, rows]);

  const labelFuncion = (f) => {
    const d = fechaLarga(f.fecha);
    const hora = f.horaInicio;
    const sala = f.sala;
    const formato = f.formato ? ` · ${f.formato}` : '';
    return `${d} · ${hora} · ${sala}${formato}`;
  };

  const limpiarFiltros = () => {
    setPeliculaId('ALL');
    setSalaId('ALL');
    setMetodo('ALL');
    setFuncionId('ALL');
  };

  const abrirModalAsientos = (asientos) => {
    setSelectedAsientos(asientos);
    setModalOpen(true);
  };

  return (
    <div className="historial-container">
      {/* Header */}
      <div className="historial-header">
        <div className="header-content">
          <div className="header-icon">📈</div>
          <div className="header-text">
            <h1 className="header-title">Historial de Venta de Entradas</h1>
            <p className="header-subtitle">Revisa las ventas por película, sala, método de pago y función.</p>
          </div>
        </div>
      </div>

      {/* Filtros */}
      <div className="filtros-section">
        <div className="filtros-grid">
          <div className="filtro-group">
            <label className="filtro-label">
              <span className="filtro-icon">🎬</span>
              Película
            </label>
            <select 
              className="filtro-select"
              value={peliculaId} 
              onChange={(e) => setPeliculaId(e.target.value)}
            >
              <option value="ALL">Todas las películas</option>
              {peliculas.map((p) => (
                <option key={p.id} value={p.id}>{p.titulo}</option>
              ))}
            </select>
          </div>

          <div className="filtro-group">
            <label className="filtro-label">
              <span className="filtro-icon">🏟️</span>
              Sala
            </label>
            <select 
              className="filtro-select"
              value={salaId} 
              onChange={(e) => setSalaId(e.target.value)}
            >
              <option value="ALL">Todas las salas</option>
              {salas.map((s) => (
                <option key={s.id} value={s.id}>{s.nombre}</option>
              ))}
            </select>
          </div>

          <div className="filtro-group">
            <label className="filtro-label">
              <span className="filtro-icon">💳</span>
              Método de pago
            </label>
            <select 
              className="filtro-select"
              value={metodo} 
              onChange={(e) => setMetodo(e.target.value)}
            >
              <option value="ALL">Todos los métodos</option>
              {metodos.map((m) => (
                <option key={m} value={m}>{m || '—'}</option>
              ))}
            </select>
          </div>

          <div className="filtro-group">
            <label className="filtro-label">
              <span className="filtro-icon">🗓️</span>
              Función
            </label>
            <select 
              className="filtro-select"
              value={funcionId} 
              onChange={(e) => setFuncionId(e.target.value)}
            >
              <option value="ALL">Todas las funciones</option>
              {funciones.map((f) => (
                <option key={f.id} value={f.id}>{labelFuncion(f)}</option>
              ))}
            </select>
          </div>
        </div>

        <div className="filtros-actions">
          <button 
            className="limpiar-btn"
            onClick={limpiarFiltros}
          >
            <span className="btn-icon">🗑️</span>
            Limpiar Filtros
          </button>
        </div>
      </div>

      {/* Tabla de Resultados */}
      <div className="tabla-section">
        <div className="tabla-header">
          <h3 className="tabla-title">Registros de Ventas</h3>
          <div className="tabla-stats">
            {loading ? (
              <span className="loading-text">Cargando...</span>
            ) : (
              <span className="results-count">{rows.length} registros encontrados</span>
            )}
          </div>
        </div>

        <div className="tabla-container">
          {loading && (
            <div className="loading-state">
              <div className="loading-spinner"></div>
              <p>Cargando historial de ventas...</p>
            </div>
          )}

          {vacio && (
            <div className="empty-state">
              <div className="empty-icon">📭</div>
              <h4>No se encontraron resultados</h4>
              <p>Intenta ajustar los filtros para ver más registros.</p>
            </div>
          )}

          {!loading && rows.length > 0 && (
            <div className="table-wrapper">
              <table className="ventas-table">
                <thead>
                  <tr>
                    <th>PELÍCULA</th>
                    <th>SALA</th>
                    <th>FUNCIÓN</th>
                    <th>ASIENTOS</th>
                    <th>ID VENTA</th>
                    <th>FECHA DE VENTA</th>
                    <th>MÉTODO DE PAGO</th>
                    <th>MONTO TOTAL</th>
                  </tr>
                </thead>
                <tbody>
                  {rows.map((r, i) => (
                    <tr key={`${r.compraId}-${i}`} className="venta-row">
                      <td className="pelicula-cell">
                        <div className="pelicula-info">
                          <span className="pelicula-title">{r.pelicula}</span>
                        </div>
                      </td>
                      <td className="sala-cell">
                        <span className="sala-badge">{r.sala}</span>
                      </td>
                      <td className="funcion-cell">
                        <span className="funcion-date">{fechaLarga(r.fecha)}</span>
                      </td>
                      <td className="asientos-cell">
                        {r.asientos ? (
                          <button 
                            className="ver-asientos-btn"
                            onClick={() => abrirModalAsientos(r.asientos)}
                            title="Ver detalles de asientos"
                          >
                            <span className="btn-icon">💺</span>
                            Ver Asientos
                          </button>
                        ) : (
                          <span className="no-asientos">—</span>
                        )}
                      </td>
                      <td className="id-cell">
                        <code className="venta-id">#{r.compraId}</code>
                      </td>
                      <td className="fecha-cell">
                        <span className="fecha-venta">{fechaHoraCorta(r.fechaVenta)}</span>
                      </td>
                      <td className="metodo-cell">
                        <span className={`metodo-badge ${r.metodoPago?.toLowerCase() || 'default'}`}>
                          {r.metodoPago || '—'}
                        </span>
                      </td>
                      <td className="monto-cell">
                        <span className="monto-total">{currency(r.montoTotal)}</span>
                      </td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
          )}
        </div>
      </div>

      {/* Modal para ver asientos */}
      {modalOpen && (
        <div className="modal-overlay">
          <div className="modal-container">
            <div className="modal-header">
              <h2 className="modal-title">💺 Detalles de Asientos</h2>
              <button 
                className="modal-close"
                onClick={() => setModalOpen(false)}
              >
                ×
              </button>
            </div>
            <div className="modal-content">
              <div className="asientos-info">
                <h4>Asientos Comprados:</h4>
                <div className="asientos-list">
                  {selectedAsientos.split(', ').map((asiento, index) => (
                    <span key={index} className="asiento-badge">
                      {asiento}
                    </span>
                  ))}
                </div>
                <p className="asientos-count">
                  Total de asientos: <strong>{selectedAsientos.split(', ').length}</strong>
                </p>
              </div>
            </div>
            <div className="modal-footer">
              <button 
                className="modal-btn primary"
                onClick={() => setModalOpen(false)}
              >
                Cerrar
              </button>
            </div>
          </div>
        </div>
      )}

      {/* Estilos CSS */}
      <style jsx>{`
        .historial-container {
          min-height: 100vh;
          background: #f8fafc;
          padding: 24px;
        }

        .historial-header {
          background: white;
          border-radius: 12px;
          padding: 32px;
          margin-bottom: 24px;
          box-shadow: 0 1px 3px rgba(0, 0, 0, 0.1);
          border: 1px solid #e2e8f0;
        }

        .header-content {
          display: flex;
          align-items: center;
          gap: 20px;
        }

        .header-icon {
          font-size: 3rem;
          background: linear-gradient(135deg, #667eea, #764ba2);
          border-radius: 12px;
          padding: 16px;
        }

        .header-title {
          font-size: 2rem;
          font-weight: 700;
          color: #1a202c;
          margin: 0;
        }

        .header-subtitle {
          font-size: 1.1rem;
          color: #718096;
          margin: 8px 0 0 0;
        }

        .filtros-section {
          background: white;
          border-radius: 12px;
          padding: 24px;
          margin-bottom: 24px;
          box-shadow: 0 1px 3px rgba(0, 0, 0, 0.1);
          border: 1px solid #e2e8f0;
        }

        .filtros-grid {
          display: grid;
          grid-template-columns: repeat(auto-fit, minmax(280px, 1fr));
          gap: 20px;
          margin-bottom: 20px;
        }

        .filtro-group {
          display: flex;
          flex-direction: column;
          gap: 8px;
          min-width: 0;
        }

        .filtro-label {
          font-weight: 600;
          color: #374151;
          display: flex;
          align-items: center;
          gap: 8px;
        }

        .filtro-icon {
          font-size: 1.1rem;
        }

        .filtro-select {
          padding: 12px 16px;
          border: 2px solid #e2e8f0;
          border-radius: 8px;
          font-size: 1rem;
          background: white;
          transition: all 0.2s ease;
          cursor: pointer;
          min-height: 48px;
          width: 100%;
          white-space: normal;
          word-wrap: break-word;
        }

        .filtro-select:focus {
          outline: none;
          border-color: #667eea;
          box-shadow: 0 0 0 3px rgba(102, 126, 234, 0.1);
        }

        .filtro-select option {
          padding: 12px 16px;
          font-size: 0.95rem;
          white-space: normal;
          word-wrap: break-word;
          border-bottom: 1px solid #f1f5f9;
        }

        .filtros-actions {
          display: flex;
          justify-content: flex-end;
        }

        .limpiar-btn {
          padding: 12px 24px;
          background: #e2e8f0;
          color: #4a5568;
          border: none;
          border-radius: 8px;
          font-size: 1rem;
          font-weight: 500;
          cursor: pointer;
          display: flex;
          align-items: center;
          gap: 8px;
          transition: all 0.2s ease;
        }

        .limpiar-btn:hover {
          background: #cbd5e0;
          transform: translateY(-1px);
        }

        .tabla-section {
          background: white;
          border-radius: 12px;
          box-shadow: 0 1px 3px rgba(0, 0, 0, 0.1);
          border: 1px solid #e2e8f0;
          overflow: hidden;
        }

        .tabla-header {
          padding: 24px;
          border-bottom: 1px solid #e2e8f0;
          background: #f7fafc;
          display: flex;
          justify-content: space-between;
          align-items: center;
        }

        .tabla-title {
          font-size: 1.5rem;
          font-weight: 600;
          color: #2d3748;
          margin: 0;
        }

        .tabla-stats {
          color: #718096;
          font-size: 0.9rem;
        }

        .results-count {
          background: #edf2f7;
          padding: 6px 12px;
          border-radius: 20px;
          font-weight: 500;
        }

        .tabla-container {
          padding: 0;
        }

        .table-wrapper {
          overflow-x: auto;
        }

        .ventas-table {
          width: 100%;
          border-collapse: collapse;
        }

        .ventas-table th {
          background: #f7fafc;
          padding: 16px 20px;
          text-align: left;
          font-weight: 600;
          color: #374151;
          font-size: 0.875rem;
          text-transform: uppercase;
          letter-spacing: 0.05em;
          border-bottom: 2px solid #e2e8f0;
        }

        .ventas-table td {
          padding: 16px 20px;
          border-bottom: 1px solid #f1f5f9;
        }

        .venta-row:hover {
          background: #f8fafc;
        }

        .pelicula-cell {
          font-weight: 500;
          color: #2d3748;
        }

        .pelicula-title {
          font-weight: 600;
        }

        .sala-cell {
          text-align: center;
        }

        .sala-badge {
          background: #e0f2fe;
          color: #0369a1;
          padding: 6px 12px;
          border-radius: 20px;
          font-size: 0.875rem;
          font-weight: 500;
        }

        .funcion-cell {
          color: #6b7280;
          font-size: 0.9rem;
        }

        .asientos-cell {
          text-align: center;
        }

        .ver-asientos-btn {
          background: #10b981;
          color: white;
          border: none;
          padding: 8px 16px;
          border-radius: 6px;
          font-size: 0.875rem;
          font-weight: 500;
          cursor: pointer;
          display: flex;
          align-items: center;
          gap: 6px;
          transition: all 0.2s ease;
        }

        .ver-asientos-btn:hover {
          background: #059669;
          transform: translateY(-1px);
        }

        .no-asientos {
          color: #9ca3af;
          font-style: italic;
        }

        .id-cell {
          text-align: center;
        }

        .venta-id {
          background: #f3f4f6;
          padding: 4px 8px;
          border-radius: 4px;
          font-family: 'Courier New', monospace;
          font-size: 0.875rem;
          color: #6b7280;
        }

        .fecha-cell {
          font-size: 0.9rem;
          color: #6b7280;
        }

        .metodo-cell {
          text-align: center;
        }

        .metodo-badge {
          padding: 6px 12px;
          border-radius: 20px;
          font-size: 0.875rem;
          font-weight: 500;
        }

        .metodo-badge.efectivo {
          background: #dcfce7;
          color: #166534;
        }

        .metodo-badge.default {
          background: #f3f4f6;
          color: #6b7280;
        }

        .monto-cell {
          text-align: right;
          font-weight: 600;
        }

        .monto-total {
          color: #059669;
          font-size: 1rem;
        }

        .loading-state {
          padding: 60px 20px;
          text-align: center;
          color: #6b7280;
        }

        .loading-spinner {
          width: 40px;
          height: 40px;
          border: 4px solid #e5e7eb;
          border-top: 4px solid #667eea;
          border-radius: 50%;
          animation: spin 1s linear infinite;
          margin: 0 auto 16px;
        }

        .empty-state {
          padding: 60px 20px;
          text-align: center;
          color: #6b7280;
        }

        .empty-icon {
          font-size: 4rem;
          margin-bottom: 16px;
          opacity: 0.5;
        }

        .empty-state h4 {
          font-size: 1.25rem;
          margin: 0 0 8px 0;
          color: #374151;
        }

        .empty-state p {
          margin: 0;
          color: #6b7280;
        }

        /* Modal Styles */
        .modal-overlay {
          position: fixed;
          top: 0;
          left: 0;
          right: 0;
          bottom: 0;
          background: rgba(0, 0, 0, 0.5);
          display: flex;
          align-items: center;
          justify-content: center;
          z-index: 1000;
          padding: 20px;
        }

        .modal-container {
          background: white;
          border-radius: 12px;
          width: 90%;
          max-width: 500px;
          max-height: 90vh;
          overflow: hidden;
          box-shadow: 0 20px 25px -5px rgba(0, 0, 0, 0.1);
        }

        .modal-header {
          padding: 24px;
          border-bottom: 1px solid #e2e8f0;
          display: flex;
          justify-content: space-between;
          align-items: center;
          background: #f7fafc;
        }

        .modal-title {
          font-size: 1.5rem;
          font-weight: 600;
          color: #2d3748;
          margin: 0;
        }

        .modal-close {
          background: none;
          border: none;
          font-size: 2rem;
          cursor: pointer;
          color: #6b7280;
          padding: 0;
          width: 40px;
          height: 40px;
          display: flex;
          align-items: center;
          justify-content: center;
          border-radius: 6px;
        }

        .modal-close:hover {
          background: #e5e7eb;
        }

        .modal-content {
          padding: 24px;
        }

        .asientos-info h4 {
          margin: 0 0 16px 0;
          color: #374151;
          font-size: 1.1rem;
        }

        .asientos-list {
          display: flex;
          flex-wrap: wrap;
          gap: 8px;
          margin-bottom: 16px;
        }

        .asiento-badge {
          background: #667eea;
          color: white;
          padding: 8px 12px;
          border-radius: 6px;
          font-size: 0.875rem;
          font-weight: 500;
        }

        .asientos-count {
          color: #6b7280;
          margin: 0;
        }

        .modal-footer {
          padding: 24px;
          border-top: 1px solid #e2e8f0;
          display: flex;
          justify-content: flex-end;
        }

        .modal-btn {
          padding: 12px 24px;
          border: none;
          border-radius: 8px;
          font-size: 1rem;
          font-weight: 500;
          cursor: pointer;
          transition: all 0.2s ease;
        }

        .modal-btn.primary {
          background: #667eea;
          color: white;
        }

        .modal-btn.primary:hover {
          background: #5a67d8;
        }

        @keyframes spin {
          0% { transform: rotate(0deg); }
          100% { transform: rotate(360deg); }
        }

        /* Responsive */
        @media (max-width: 768px) {
          .historial-container {
            padding: 16px;
          }

          .filtros-grid {
            grid-template-columns: 1fr;
          }

          .tabla-header {
            flex-direction: column;
            gap: 12px;
            align-items: flex-start;
          }

          .ventas-table {
            font-size: 0.875rem;
          }

          .ventas-table th,
          .ventas-table td {
            padding: 12px 8px;
          }

          .filtro-select {
            font-size: 16px; /* Previene el zoom en iOS */
          }
        }
      `}</style>
    </div>
  );
}