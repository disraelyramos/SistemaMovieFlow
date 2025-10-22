// src/pages/VentaDeEntradas.jsx
import React, { useEffect, useMemo, useState } from 'react';
import axios from 'axios';
import '../styles/dashboard.css';

/* ================== API BASE ================== */
const API_BASE =
  import.meta.env?.VITE_API_BASE ||
  import.meta.env?.VITE_API_BASE_URL ||
  import.meta.env?.VITE_API_URL ||
  'http://localhost:3001';

/* ================== Axios helpers ================== */
const authHeaders = () => {
  const token = localStorage.getItem('mf_token');
  const h = {};
  if (token) h.Authorization = `Bearer ${token}`;
  return h;
};

const get = (path, cfg = {}) =>
  axios.get(`${API_BASE}${path}`, { withCredentials: false, headers: { ...authHeaders() }, ...cfg });

const post = (path, body, cfg = {}) =>
  axios.post(`${API_BASE}${path}`, body, {
    withCredentials: false,
    headers: { ...authHeaders(), ...(cfg.headers || {}) },
    ...cfg,
  });

/* ================== Utils ================== */
const currency = (v = 0) =>
  Number(v || 0).toLocaleString('es-GT', {
    style: 'currency',
    currency: 'GTQ',
    minimumFractionDigits: 2,
  });

const diasAbbr = ['Dom', 'Lun', 'Mar', 'Mié', 'Jue', 'Vie', 'Sáb'];
const pad2 = (n) => String(n).padStart(2, '0');

const parseFecha = (v) => {
  if (!v) return null;
  const m = /^(\d{4})-(\d{2})-(\d{2})$/.exec(String(v));
  if (m) return new Date(Number(m[1]), Number(m[2]) - 1, Number(m[3]));
  const d = new Date(v);
  return Number.isNaN(d.getTime()) ? null : d;
};

const formatFechaCorta = (v) => {
  const d = parseFecha(v);
  if (!d) return '—';
  return `${diasAbbr[d.getDay()]} ${pad2(d.getDate())}/${pad2(d.getMonth() + 1)}/${d.getFullYear()}`;
};

/* ================== Normalizadores ================== */
const normMovie = (m) => ({
  id: m.id,
  titulo: m.titulo,
  duracion: m.duracionMin,
  genero: m.categoriaNombre ?? null,
  idioma: m.idioma ?? null,
  clasificacion: m.clasificacion ?? null,
  poster: m.imagenUrl ?? null,
});

const normFuncion = (f) => {
  const totalSeats = Number(f.totalSeats ?? f.TOTALSEATS ?? 0);
  const vendidos   = Number(f.vendidos   ?? f.VENDIDOS   ?? 0);
  const reservados = Number(f.reservados ?? f.RESERVADOS ?? 0);
  const disponibles= Number(f.disponibles?? f.DISPONIBLES?? Math.max(0, totalSeats - vendidos - reservados));
  return {
    id: f.id,
    peliculaId: f.peliculaId,
    salaId: f.salaId,
    salaNombre: f.salaNombre ?? `Sala ${f.salaId}`,
    horaInicio: f.horaInicio,
    horaFinal: f.horaFinal,
    precio: Number(f.precio ?? 0),
    formato: f.formato || null,
    fecha: f.fecha || null,
    totalSeats, vendidos, reservados, disponibles,
    soldOut: vendidos >= totalSeats && totalSeats > 0,
  };
};

const normSeat = (s) => ({
  idFa: s.idFa,
  fila: String(s.fila),
  col: Number(s.columna),
  estado: String(s.estado || '').toUpperCase(), // DISPONIBLE | RESERVADO | VENDIDO | BLOQUEADO
  bloqueadoHasta: s.bloqueado_hasta || null,
});
const seatKey = (s) => `${s.fila}-${s.col}`;

/* ================== Componente ================== */
export default function VentaDeEntradas() {
  // catálogo
  const [peliculas, setPeliculas] = useState([]);
  const [query, setQuery] = useState('');
  const [cat, setCat] = useState('ALL');

  // selección
  const [peliculaSel, setPeliculaSel] = useState(null);
  const [funciones, setFunciones] = useState([]);
  const [funcionSel, setFuncionSel] = useState(null);

  // asientos
  const [loadingSeats, setLoadingSeats] = useState(false);
  const [seats, setSeats] = useState([]);
  const [seleccionados, setSeleccionados] = useState([]);

  // reservas
  const [reservas, setReservas] = useState([]);

  // venta
  const [metodoPago, setMetodoPago] = useState('EFECTIVO');
  const [submitting, setSubmitting] = useState(false);

  // modal
  const [modalOpen, setModalOpen] = useState(false);

  // cargar películas (vista empleado)
  useEffect(() => {
    (async () => {
      try {
        const { data } = await get('/api/empleado/cartelera');
        setPeliculas(Array.isArray(data) ? data.map(normMovie) : []);
      } catch {
        setPeliculas([]);
      }
    })();
  }, []);

  // categorías dinámicas
  const categorias = useMemo(
    () => ['ALL', ...new Set(peliculas.map((p) => p.genero).filter(Boolean))],
    [peliculas]
  );

  // filtro por búsqueda/categoría
  const listFiltrada = useMemo(() => {
    const q = query.trim().toLowerCase();
    return peliculas.filter((p) => {
      if (cat !== 'ALL' && (p.genero ?? '') !== cat) return false;
      if (!q) return true;
      return (p.titulo ?? '').toLowerCase().includes(q);
    });
  }, [peliculas, query, cat]);

  // helpers asientos
  const ordenarYSetear = (arr) => {
    const a = [...arr];
    a.sort((x, y) => (x.fila === y.fila ? x.col - y.col : x.fila.localeCompare(y.fila)));
    setSeats(a);
  };

  const cargarAsientos = async (funcionId) => {
    setLoadingSeats(true);
    try {
      const { data } = await get(`/api/empleado/funciones/${funcionId}/asientos`);
      ordenarYSetear(Array.isArray(data) ? data.map(normSeat) : []);
    } catch {
      setSeats([]);
    } finally {
      setLoadingSeats(false);
    }
  };

  // reservas: listar para la función
  const cargarReservas = async (funcionId) => {
    try {
      const { data } = await get(`/api/empleado/funciones/${funcionId}/reservas`);
      setReservas(Array.isArray(data) ? data : []);
    } catch {
      setReservas([]);
    }
  };

  const abrirFunciones = async (pelicula) => {
    setPeliculaSel(pelicula);
    setFuncionSel(null);
    setSeats([]);
    setSeleccionados([]);
    setReservas([]);
    setMetodoPago('EFECTIVO');
    try {
      const { data } = await get(`/api/empleado/cartelera/${pelicula.id}/funciones`);
      setFunciones(Array.isArray(data) ? data.map(normFuncion) : []);
    } catch {
      setFunciones([]);
    }
  };

  const abrirModalAsientos = async (f) => {
    setFuncionSel(f);
    setSeleccionados([]);
    setReservas([]);
    setMetodoPago('EFECTIVO');
    try {
      await post(`/api/empleado/funciones/${f.id}/liberar-reservas-vencidas`, {});
    } catch {}
    await cargarAsientos(f.id);
    await cargarReservas(f.id);
    setModalOpen(true);
  };

  const filas = useMemo(() => Array.from(new Set(seats.map((s) => s.fila))), [seats]);
  const maxCols = useMemo(() => {
    let m = 0;
    seats.forEach((s) => { if (s.col > m) m = s.col; });
    return m || 10;
  }, [seats]);

  // permitir seleccionar RESERVADO, prohibir VENDIDO/BLOQUEADO reales
  const toggleSeat = (s) => {
    const esVendido = s.estado === 'VENDIDO';
    const esBloqueadoReal = s.estado === 'BLOQUEADO';
    if (esVendido || esBloqueadoReal) return;
    const key = seatKey(s);
    setSeleccionados((prev) => (prev.includes(key) ? prev.filter((k) => k !== key) : [...prev, key]));
  };

  const selectedSeatIds = useMemo(() => {
    const map = new Map(seats.map((s) => [seatKey(s), s.idFa]));
    return seleccionados.map((k) => map.get(k)).filter(Boolean);
  }, [seats, seleccionados]);

  const precioUnit = Number(funcionSel?.precio || 0);
  const total = precioUnit * seleccionados.length;

  // vender en taquilla y abrir tickets
  const confirmarVenta = async () => {
    if (!funcionSel || selectedSeatIds.length === 0) return;
    setSubmitting(true);
    try {
      const r = await post(`/api/empleado/funciones/${funcionSel.id}/vender`, {
        asientos: selectedSeatIds,
        metodoPago: 'EFECTIVO',
      });
      alert('¡Venta registrada! Asientos vendidos.');
      try {
        const compraId = r?.data?.compraIdNueva;
        if (compraId) {
          window.open(`${API_BASE}/api/empleado/tickets/compra/${compraId}`, '_blank');
        }
      } catch {}
      await cargarAsientos(funcionSel.id);
      await cargarReservas(funcionSel.id);
      setSeleccionados([]);
    } catch (e) {
      console.error('Confirmar venta ->', e);
      alert('Error al confirmar la venta.');
    } finally {
      setSubmitting(false);
    }
  };

  const imgUrl = (p) => (p.poster && !p.poster.startsWith('http') ? `${API_BASE}${p.poster}` : p.poster);

  return (
    <div className="venta-entradas-container">
      {/* Header */}
      <div className="venta-header">
        <div className="header-content">
          <div className="header-icon">🎫</div>
          <div className="header-text">
            <h1 className="header-title">Venta de Entradas</h1>
            <p className="header-subtitle">Panel de control para empleados</p>
          </div>
        </div>
      </div>

      {/* Search Bar */}
      <div className="search-section">
        <div className="search-container">
          <div className="search-input-group">
            <div className="search-icon">🔍</div>
            <input
              type="text"
              className="search-input"
              placeholder="Buscar película por título..."
              value={query}
              onChange={(e) => setQuery(e.target.value)}
            />
          </div>
          <select className="category-select" value={cat} onChange={(e) => setCat(e.target.value)}>
            {categorias.map((c) => (
              <option key={c} value={c}>{c === 'ALL' ? 'Todas las categorías' : c}</option>
            ))}
          </select>
          <button className="search-btn">
            <span className="btn-icon">🔍</span>
            Buscar
          </button>
        </div>
      </div>

      {/* Main Content Grid - Solo 2 secciones */}
      <div className="venta-grid">
        {/* Panel 1: Películas */}
        <div className="panel movies-panel">
          <div className="panel-header">
            <h3 className="panel-title">Películas Disponibles</h3>
            <span className="panel-count">{listFiltrada.length}</span>
          </div>
          <div className="panel-content">
            {listFiltrada.length === 0 ? (
              <div className="empty-state">
                <div className="empty-icon">🎭</div>
                <p className="empty-text">No hay películas activas que coincidan</p>
              </div>
            ) : (
              <div className="movies-grid">
                {listFiltrada.map((p) => (
                  <div 
                    key={p.id} 
                    className={`movie-card ${peliculaSel?.id === p.id ? 'active' : ''}`}
                    onClick={() => abrirFunciones(p)}
                  >
                    <div 
                      className="movie-poster"
                      style={{ backgroundImage: imgUrl(p) ? `url('${imgUrl(p)}')` : 'none' }}
                    >
                      {!imgUrl(p) && <div className="poster-placeholder">🎬</div>}
                    </div>
                    <div className="movie-info">
                      <h4 className="movie-title">{p.titulo}</h4>
                      <div className="movie-details">
                        <span className="detail-item">⏱️ {p.duracion ?? '--'} min</span>
                        {p.genero && <span className="detail-item">🎭 {p.genero}</span>}
                        {p.idioma && <span className="detail-item">🗣️ {p.idioma}</span>}
                      </div>
                    </div>
                    <div className="movie-action">
                      <span className="action-indicator">→</span>
                    </div>
                  </div>
                ))}
              </div>
            )}
          </div>
        </div>

        {/* Panel 2: Funciones */}
        <div className="panel functions-panel">
          <div className="panel-header">
            <h3 className="panel-title">
              Funciones {peliculaSel && `- ${peliculaSel.titulo}`}
            </h3>
          </div>
          <div className="panel-content">
            {peliculaSel == null ? (
              <div className="empty-state">
                <div className="empty-icon">📅</div>
                <p className="empty-text">Selecciona una película para ver funciones</p>
              </div>
            ) : funciones.length === 0 ? (
              <div className="empty-state">
                <div className="empty-icon">❌</div>
                <p className="empty-text">No hay funciones activas para esta película</p>
              </div>
            ) : (
              <div className="functions-list">
                {funciones.map((f) => {
                  const disabled = !!f.soldOut;
                  return (
                    <div
                      key={f.id}
                      className={`function-card ${disabled ? 'sold-out' : ''}`}
                      onClick={() => !disabled && abrirModalAsientos(f)}
                    >
                      <div className="function-time">
                        <div className="time-badge">{f.horaInicio}</div>
                        {f.formato && <span className="format-badge">{f.formato}</span>}
                      </div>
                      <div className="function-details">
                        <div className="function-location">
                          <span className="location-icon">📍</span>
                          {f.salaNombre}
                        </div>
                        <div className="function-date">{formatFechaCorta(f.fecha)}</div>
                        <div className="function-stats">
                          <span className="stat">Vendidos: {f.vendidos}</span>
                          <span className="stat">Disponibles: {f.disponibles}</span>
                        </div>
                      </div>
                      <div className="function-price">
                        <div className="price-amount">{currency(f.precio)}</div>
                        {disabled && <div className="sold-out-badge">AGOTADO</div>}
                        {!disabled && <div className="select-btn">Seleccionar</div>}
                      </div>
                    </div>
                  );
                })}
              </div>
            )}
          </div>
        </div>
      </div>

      {/* Modal de Selección de Asientos */}
      {modalOpen && (
        <div className="modal-overlay">
          <div className="modal-container">
            <div className="modal-header">
              <h2 className="modal-title">
                Seleccionar Asientos - {peliculaSel?.titulo}
              </h2>
              <button 
                className="modal-close"
                onClick={() => setModalOpen(false)}
              >
                ×
              </button>
            </div>

            <div className="modal-content">
              {/* Información de la función */}
              <div className="funcion-info">
                <div className="info-item">
                  <strong>Horario:</strong> {funcionSel?.horaInicio}
                </div>
                <div className="info-item">
                  <strong>Sala:</strong> {funcionSel?.salaNombre}
                </div>
                <div className="info-item">
                  <strong>Fecha:</strong> {formatFechaCorta(funcionSel?.fecha)}
                </div>
                <div className="info-item">
                  <strong>Precio:</strong> {currency(funcionSel?.precio)}
                </div>
              </div>

              {loadingSeats ? (
                <div className="loading-state">
                  <div className="loading-spinner"></div>
                  <p>Cargando mapa de asientos...</p>
                </div>
              ) : (
                <>
                  {/* Leyenda */}
                  <div className="legend-section">
                    <h4 className="legend-title">Estado de Asientos</h4>
                    <div className="legend-grid">
                      <div className="legend-item">
                        <div className="legend-color available"></div>
                        <span>Disponible</span>
                      </div>
                      <div className="legend-item">
                        <div className="legend-color reserved"></div>
                        <span>Reservado</span>
                      </div>
                      <div className="legend-item">
                        <div className="legend-color occupied"></div>
                        <span>Ocupado</span>
                      </div>
                      <div className="legend-item">
                        <div className="legend-color blocked"></div>
                        <span>Bloqueado</span>
                      </div>
                      <div className="legend-item">
                        <div className="legend-color selected"></div>
                        <span>Seleccionado</span>
                      </div>
                    </div>
                  </div>

                  {/* Mapa de Asientos */}
                  <div className="seats-container">
                    <div className="screen-indicator">🎬 PANTALLA 🎬</div>
                    <div 
                      className="seats-grid"
                      style={{ gridTemplateColumns: `repeat(${maxCols}, 35px)` }}
                    >
                      {filas.map((fila) => {
                        const maxCol = seats.filter((x) => x.fila === fila).reduce((m, x) => Math.max(m, x.col), 0);
                        return Array.from({ length: maxCol }).map((_, i) => {
                          const col = i + 1;
                          const s = seats.find((x) => x.fila === fila && x.col === col);
                          const key = s ? `${s.fila}-${s.col}` : `${fila}-${col}`;
                          if (!s) return <div key={key} className="seat seat-empty" />;
                          const isSel = seleccionados.includes(key);
                          const esReservado = s.estado === 'RESERVADO';
                          const esVendido = s.estado === 'VENDIDO';
                          const esBloqueado = s.estado === 'BLOQUEADO';
                          const state = isSel
                            ? 'selected'
                            : esReservado
                            ? 'reserved'
                            : esVendido
                            ? 'occupied'
                            : esBloqueado
                            ? 'blocked'
                            : 'available';
                          return (
                            <div
                              key={key}
                              className={`seat ${state}`}
                              onClick={() => toggleSeat(s)}
                              title={`${s.fila}${s.col}`}
                            >
                              {s.fila}{s.col}
                            </div>
                          );
                        });
                      })}
                    </div>
                  </div>

                  {/* Panel de Reservas */}
                  {reservas.length > 0 && (
                    <div className="reservas-section">
                      <h4 className="reservas-title">🧾 Reservas Pendientes</h4>
                      <div className="reservas-list">
                        {reservas.map((r) => (
                          <div key={r.numeroReserva} className="reserva-card">
                            <div className="reserva-header">
                              <span className="reserva-number">Reserva #{r.numeroReserva}</span>
                              <span className="reserva-date">
                                {new Date(r.creadoEn).toLocaleString()}
                              </span>
                            </div>
                            <div className="reserva-details">
                              <div className="reserva-seats">
                                <strong>Asientos:</strong> {String(r.asientos || '').replace(/,/g, ', ')}
                              </div>
                            </div>
                            <button
                              className="confirm-btn"
                              onClick={async () => {
                                try {
                                  await post(`/api/empleado/funciones/${funcionSel.id}/confirmar-reserva`, {
                                    numeroReserva: r.numeroReserva,
                                    metodoPago: 'EFECTIVO',
                                  });
                                  alert(`Reserva ${r.numeroReserva} confirmada`);
                                  await cargarAsientos(funcionSel.id);
                                  await cargarReservas(funcionSel.id);
                                  window.open(`${API_BASE}/api/empleado/funciones/${funcionSel.id}/reservas/${r.numeroReserva}/tickets`, '_blank');
                                } catch {
                                  alert('No se pudo confirmar la reserva');
                                }
                              }}
                            >
                              Confirmar Reserva
                            </button>
                          </div>
                        ))}
                      </div>
                    </div>
                  )}

                  {/* Resumen de Compra */}
                  <div className="purchase-summary">
                    <h4 className="summary-title">Resumen de Compra</h4>
                    <div className="summary-grid">
                      <div className="summary-item">
                        <span className="summary-label">Asientos seleccionados:</span>
                        <span className="summary-value seats-list">
                          {seleccionados.length > 0
                            ? seleccionados.map(k => {
                                const [ff, cc] = k.split('-');
                                return `${ff}${cc}`;
                              }).join(', ')
                            : '—'}
                        </span>
                      </div>
                      <div className="summary-item">
                        <span className="summary-label">Cantidad:</span>
                        <span className="summary-value">{seleccionados.length}</span>
                      </div>
                      <div className="summary-item total">
                        <span className="summary-label">Total a Pagar:</span>
                        <span className="summary-value total-amount">{currency(total)}</span>
                      </div>
                    </div>

                    <div className="payment-section">
                      <div className="payment-method-display">
                        <span className="payment-label">Método de pago:</span>
                        <span className="payment-value">{metodoPago}</span>
                      </div>
                      
                      <div className="modal-actions">
                        <button
                          className="cancel-btn"
                          onClick={() => setModalOpen(false)}
                        >
                          Cancelar
                        </button>
                        <button
                          className="confirm-purchase-btn"
                          disabled={seleccionados.length === 0 || submitting}
                          onClick={confirmarVenta}
                        >
                          {submitting ? (
                            <>
                              <div className="btn-spinner"></div>
                              Procesando...
                            </>
                          ) : (
                            <>
                              <span className="btn-icon">🎫</span>
                              Confirmar Venta
                            </>
                          )}
                        </button>
                      </div>
                    </div>
                  </div>
                </>
              )}
            </div>
          </div>
        </div>
      )}

      {/* Estilos CSS */}
      <style jsx>{`
        .venta-entradas-container {
          min-height: 100vh;
          background: #f8fafc;
          padding: 20px;
        }

        .venta-header {
          background: white;
          border-radius: 12px;
          padding: 24px;
          margin-bottom: 24px;
          box-shadow: 0 1px 3px rgba(0, 0, 0, 0.1);
          border: 1px solid #e2e8f0;
        }

        .header-content {
          display: flex;
          align-items: center;
          gap: 16px;
        }

        .header-icon {
          font-size: 2.5rem;
          background: #667eea;
          color: white;
          border-radius: 12px;
          padding: 12px;
        }

        .header-title {
          font-size: 1.75rem;
          font-weight: 700;
          color: #1a202c;
          margin: 0;
        }

        .header-subtitle {
          font-size: 1rem;
          color: #718096;
          margin: 0;
        }

        .search-section {
          background: white;
          border-radius: 12px;
          padding: 20px;
          margin-bottom: 24px;
          box-shadow: 0 1px 3px rgba(0, 0, 0, 0.1);
          border: 1px solid #e2e8f0;
        }

        .search-container {
          display: flex;
          gap: 12px;
          align-items: center;
        }

        .search-input-group {
          flex: 1;
          position: relative;
          display: flex;
          align-items: center;
        }

        .search-icon {
          position: absolute;
          left: 12px;
          font-size: 1.1rem;
          color: #718096;
        }

        .search-input {
          width: 100%;
          padding: 12px 12px 12px 40px;
          border: 2px solid #e2e8f0;
          border-radius: 8px;
          font-size: 1rem;
          transition: all 0.2s ease;
          background: white;
        }

        .search-input:focus {
          outline: none;
          border-color: #667eea;
          box-shadow: 0 0 0 3px rgba(102, 126, 234, 0.1);
        }

        .category-select {
          padding: 12px 16px;
          border: 2px solid #e2e8f0;
          border-radius: 8px;
          font-size: 1rem;
          background: white;
          min-width: 180px;
          cursor: pointer;
        }

        .search-btn {
          padding: 12px 20px;
          background: #667eea;
          color: white;
          border: none;
          border-radius: 8px;
          font-size: 1rem;
          font-weight: 600;
          cursor: pointer;
          display: flex;
          align-items: center;
          gap: 8px;
          transition: background 0.2s ease;
        }

        .search-btn:hover {
          background: #5a67d8;
        }

        .venta-grid {
          display: grid;
          grid-template-columns: 1fr 1fr;
          gap: 24px;
          height: calc(100vh - 200px);
        }

        @media (max-width: 1024px) {
          .venta-grid {
            grid-template-columns: 1fr;
            height: auto;
          }
        }

        .panel {
          background: white;
          border-radius: 12px;
          overflow: hidden;
          box-shadow: 0 1px 3px rgba(0, 0, 0, 0.1);
          border: 1px solid #e2e8f0;
          display: flex;
          flex-direction: column;
        }

        .panel-header {
          padding: 20px 24px;
          border-bottom: 1px solid #e2e8f0;
          background: #f7fafc;
        }

        .panel-title {
          font-size: 1.25rem;
          font-weight: 600;
          color: #2d3748;
          margin: 0;
          display: flex;
          align-items: center;
          justify-content: space-between;
        }

        .panel-count {
          background: #667eea;
          color: white;
          padding: 4px 12px;
          border-radius: 20px;
          font-size: 0.875rem;
          font-weight: 600;
        }

        .panel-content {
          flex: 1;
          padding: 20px;
          overflow-y: auto;
        }

        /* Movies Grid */
        .movies-grid {
          display: grid;
          gap: 16px;
        }

        .movie-card {
          display: flex;
          gap: 16px;
          padding: 16px;
          border: 2px solid #e2e8f0;
          border-radius: 8px;
          cursor: pointer;
          transition: all 0.2s ease;
          background: white;
        }

        .movie-card:hover {
          border-color: #667eea;
          transform: translateY(-1px);
        }

        .movie-card.active {
          border-color: #667eea;
          background: #f0f4ff;
        }

        .movie-poster {
          width: 60px;
          height: 90px;
          border-radius: 6px;
          background: #f7fafc;
          background-size: cover;
          background-position: center;
          display: flex;
          align-items: center;
          justify-content: center;
          flex-shrink: 0;
        }

        .poster-placeholder {
          font-size: 1.5rem;
          color: #cbd5e0;
        }

        .movie-info {
          flex: 1;
          min-width: 0;
        }

        .movie-title {
          font-size: 1rem;
          font-weight: 600;
          color: #2d3748;
          margin: 0 0 8px 0;
          white-space: nowrap;
          overflow: hidden;
          text-overflow: ellipsis;
        }

        .movie-details {
          display: flex;
          flex-direction: column;
          gap: 4px;
        }

        .detail-item {
          font-size: 0.875rem;
          color: #718096;
        }

        .movie-action {
          display: flex;
          align-items: center;
        }

        .action-indicator {
          color: #667eea;
          font-size: 1.25rem;
          font-weight: bold;
        }

        /* Functions List */
        .functions-list {
          display: grid;
          gap: 12px;
        }

        .function-card {
          display: flex;
          gap: 16px;
          padding: 16px;
          border: 2px solid #e2e8f0;
          border-radius: 8px;
          cursor: pointer;
          transition: all 0.2s ease;
          background: white;
        }

        .function-card:hover:not(.sold-out) {
          border-color: #667eea;
          transform: translateY(-1px);
        }

        .function-card.sold-out {
          opacity: 0.6;
          cursor: not-allowed;
        }

        .function-time {
          display: flex;
          flex-direction: column;
          gap: 8px;
          align-items: center;
          flex-shrink: 0;
        }

        .time-badge {
          background: #667eea;
          color: white;
          padding: 8px 12px;
          border-radius: 6px;
          font-weight: 600;
          font-size: 0.9rem;
        }

        .format-badge {
          background: #e2e8f0;
          color: #4a5568;
          padding: 4px 8px;
          border-radius: 4px;
          font-size: 0.75rem;
          font-weight: 500;
        }

        .function-details {
          flex: 1;
        }

        .function-location {
          display: flex;
          align-items: center;
          gap: 8px;
          font-weight: 500;
          color: #2d3748;
          margin-bottom: 4px;
        }

        .location-icon {
          font-size: 0.875rem;
        }

        .function-date {
          font-size: 0.875rem;
          color: #718096;
          margin-bottom: 8px;
        }

        .function-stats {
          display: flex;
          gap: 12px;
        }

        .stat {
          font-size: 0.75rem;
          color: #718096;
        }

        .function-price {
          display: flex;
          flex-direction: column;
          align-items: flex-end;
          gap: 8px;
          flex-shrink: 0;
        }

        .price-amount {
          font-size: 1rem;
          font-weight: 600;
          color: #2d3748;
        }

        .sold-out-badge {
          background: #e53e3e;
          color: white;
          padding: 4px 8px;
          border-radius: 4px;
          font-size: 0.75rem;
          font-weight: 500;
        }

        .select-btn {
          background: #48bb78;
          color: white;
          padding: 6px 12px;
          border-radius: 4px;
          font-size: 0.75rem;
          font-weight: 500;
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
          max-width: 1000px;
          max-height: 90vh;
          overflow-y: auto;
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
          color: #718096;
          padding: 0;
          width: 40px;
          height: 40px;
          display: flex;
          align-items: center;
          justify-content: center;
          border-radius: 6px;
        }

        .modal-close:hover {
          background: #e2e8f0;
        }

        .modal-content {
          padding: 24px;
        }

        .funcion-info {
          display: grid;
          grid-template-columns: repeat(auto-fit, minmax(200px, 1fr));
          gap: 16px;
          margin-bottom: 24px;
          padding: 16px;
          background: #f7fafc;
          border-radius: 8px;
        }

        .info-item {
          font-size: 0.9rem;
          color: #4a5568;
        }

        /* Seats Section */
        .seats-container {
          text-align: center;
          margin: 24px 0;
        }

        .screen-indicator {
          background: #2d3748;
          color: white;
          padding: 12px;
          border-radius: 6px;
          margin-bottom: 24px;
          font-weight: 600;
          font-size: 1rem;
        }

        .seats-grid {
          display: grid;
          gap: 6px;
          justify-content: center;
          margin: 0 auto;
          max-width: fit-content;
        }

        .seat {
          width: 35px;
          height: 35px;
          border-radius: 6px;
          display: flex;
          align-items: center;
          justify-content: center;
          font-size: 0.75rem;
          font-weight: 600;
          color: white;
          cursor: pointer;
          transition: all 0.2s ease;
        }

        .seat:hover:not(.occupied):not(.blocked) {
          transform: scale(1.1);
        }

        .seat.available {
          background: #48bb78;
        }

        .seat.reserved {
          background: #ed8936;
        }

        .seat.occupied {
          background: #e53e3e;
          cursor: not-allowed;
        }

        .seat.blocked {
          background: #a0aec0;
          cursor: not-allowed;
        }

        .seat.selected {
          background: #667eea;
          transform: scale(1.1);
          box-shadow: 0 4px 12px rgba(102, 126, 234, 0.4);
        }

        .seat-empty {
          visibility: hidden;
        }

        /* Legend */
        .legend-section {
          margin-bottom: 20px;
        }

        .legend-title {
          font-size: 1rem;
          font-weight: 600;
          color: #2d3748;
          margin-bottom: 12px;
        }

        .legend-grid {
          display: grid;
          grid-template-columns: repeat(auto-fit, minmax(120px, 1fr));
          gap: 12px;
        }

        .legend-item {
          display: flex;
          align-items: center;
          gap: 8px;
          font-size: 0.875rem;
          color: #4a5568;
        }

        .legend-color {
          width: 16px;
          height: 16px;
          border-radius: 4px;
          flex-shrink: 0;
        }

        .legend-color.available { background: #48bb78; }
        .legend-color.reserved { background: #ed8936; }
        .legend-color.occupied { background: #e53e3e; }
        .legend-color.blocked { background: #a0aec0; }
        .legend-color.selected { background: #667eea; }

        /* Reservas */
        .reservas-section {
          margin: 24px 0;
        }

        .reservas-title {
          font-size: 1rem;
          font-weight: 600;
          color: #2d3748;
          margin-bottom: 16px;
        }

        .reservas-list {
          display: grid;
          gap: 12px;
        }

        .reserva-card {
          padding: 16px;
          border: 1px solid #e2e8f0;
          border-radius: 8px;
          background: white;
        }

        .reserva-header {
          display: flex;
          justify-content: space-between;
          align-items: center;
          margin-bottom: 8px;
        }

        .reserva-number {
          font-weight: 600;
          color: #2d3748;
        }

        .reserva-date {
          font-size: 0.875rem;
          color: #718096;
        }

        .reserva-details {
          margin-bottom: 12px;
        }

        .reserva-seats {
          font-size: 0.875rem;
          color: #4a5568;
        }

        .confirm-btn {
          width: 100%;
          padding: 8px 16px;
          background: #48bb78;
          color: white;
          border: none;
          border-radius: 6px;
          font-size: 0.875rem;
          font-weight: 500;
          cursor: pointer;
          transition: background 0.2s ease;
        }

        .confirm-btn:hover {
          background: #38a169;
        }

        /* Purchase Summary */
        .purchase-summary {
          background: #f7fafc;
          padding: 20px;
          border-radius: 8px;
          margin-top: 24px;
        }

        .summary-title {
          font-size: 1.125rem;
          font-weight: 600;
          color: #2d3748;
          margin-bottom: 16px;
        }

        .summary-grid {
          display: grid;
          gap: 12px;
          margin-bottom: 20px;
        }

        .summary-item {
          display: flex;
          justify-content: space-between;
          align-items: center;
        }

        .summary-label {
          font-weight: 500;
          color: #4a5568;
        }

        .summary-value {
          font-weight: 600;
          color: #2d3748;
        }

        .summary-item.total {
          padding-top: 12px;
          border-top: 2px solid #e2e8f0;
        }

        .total-amount {
          font-size: 1.25rem;
          color: #667eea;
        }

        .seats-list {
          font-family: 'Courier New', monospace;
          background: #edf2f7;
          padding: 4px 8px;
          border-radius: 4px;
        }

        .payment-section {
          display: flex;
          flex-direction: column;
          gap: 16px;
        }

        .payment-method-display {
          display: flex;
          justify-content: space-between;
          align-items: center;
          padding: 12px;
          background: white;
          border-radius: 6px;
          border: 1px solid #e2e8f0;
        }

        .payment-label {
          font-weight: 500;
          color: #4a5568;
        }

        .payment-value {
          font-weight: 600;
          color: #2d3748;
        }

        .modal-actions {
          display: flex;
          gap: 12px;
        }

        .cancel-btn {
          flex: 1;
          padding: 12px 24px;
          background: #e2e8f0;
          color: #4a5568;
          border: none;
          border-radius: 6px;
          font-size: 1rem;
          font-weight: 500;
          cursor: pointer;
          transition: background 0.2s ease;
        }

        .cancel-btn:hover {
          background: #cbd5e0;
        }

        .confirm-purchase-btn {
          flex: 2;
          padding: 12px 24px;
          background: #667eea;
          color: white;
          border: none;
          border-radius: 6px;
          font-size: 1rem;
          font-weight: 600;
          cursor: pointer;
          display: flex;
          align-items: center;
          justify-content: center;
          gap: 8px;
          transition: background 0.2s ease;
        }

        .confirm-purchase-btn:hover:not(:disabled) {
          background: #5a67d8;
        }

        .confirm-purchase-btn:disabled {
          opacity: 0.6;
          cursor: not-allowed;
        }

        .btn-spinner {
          width: 16px;
          height: 16px;
          border: 2px solid transparent;
          border-top: 2px solid white;
          border-radius: 50%;
          animation: spin 1s linear infinite;
        }

        @keyframes spin {
          0% { transform: rotate(0deg); }
          100% { transform: rotate(360deg); }
        }

        /* Empty States */
        .empty-state {
          text-align: center;
          padding: 40px 20px;
          color: #718096;
        }

        .empty-icon {
          font-size: 2.5rem;
          margin-bottom: 16px;
          opacity: 0.5;
        }

        .empty-text {
          font-size: 1rem;
          margin: 0;
        }

        .loading-state {
          text-align: center;
          padding: 40px 20px;
          color: #718096;
        }

        .loading-spinner {
          width: 40px;
          height: 40px;
          border: 4px solid #e2e8f0;
          border-top: 4px solid #667eea;
          border-radius: 50%;
          animation: spin 1s linear infinite;
          margin: 0 auto 16px;
        }
      `}</style>
    </div>
  );
}