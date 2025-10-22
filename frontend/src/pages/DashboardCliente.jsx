// src/pages/DashboardCliente.jsx
import React, { useEffect, useMemo, useState } from 'react';
import { useNavigate } from 'react-router-dom';
import axios from 'axios';

/* ================== Config & helpers ================== */
const API_BASE = import.meta.env?.VITE_API_BASE_URL || 'http://localhost:3001';

const get = (path, cfg = {}) =>
  axios.get(`${API_BASE}${path}`, { withCredentials: false, ...cfg });

const authHeaders = () => {
  const token = localStorage.getItem('mf_token');
  const h = {};
  if (token) h.Authorization = `Bearer ${token}`;
  return h;
};

const post = (path, body, cfg = {}) =>
  axios.post(`${API_BASE}${path}`, body, {
    withCredentials: false,
    headers: { ...authHeaders(), ...(cfg.headers || {}) },
    ...cfg,
  });

const currency = (v = 0) =>
  Number(v || 0).toLocaleString('es-GT', { style: 'currency', currency: 'GTQ', minimumFractionDigits: 2 });

/* Fecha corta "Lun 24/09/2025" */
const diasAbbr = ['Dom', 'Lun', 'Mar', 'Mié', 'Jue', 'Vie', 'Sáb'];
const pad2 = (n) => String(n).padStart(2, '0');

const parseFecha = (v) => {
  if (!v) return null;
  if (typeof v === 'string') {
    const m = v.match(/^(\d{4})-(\d{2})-(\d{2})(?:[ T](\d{2}):(\d{2})(?::(\d{2}))?)?$/);
    if (m) {
      const [, y, mo, d, h = '00', mi = '00', s = '00'] = m;
      return new Date(+y, +mo - 1, +d, +h, +mi, +s);
    }
  }
  const d = new Date(v);
  return Number.isNaN(d.getTime()) ? null : d;
};

const formatFechaCorta = (v) => {
  const d = parseFecha(v);
  if (!d) return '—';
  return `${diasAbbr[d.getDay()]} ${pad2(d.getDate())}/${pad2(d.getMonth() + 1)}/${d.getFullYear()}`;
};

/* Idem key para evitar duplicados si el usuario hace doble click */
const makeIdemKey = () =>
  (typeof crypto !== 'undefined' && crypto.randomUUID)
    ? crypto.randomUUID()
    : `${Date.now()}_${Math.random().toString(16).slice(2)}`;

/* ================== REGLAS DE NEGOCIO ================== */
// Límite de butacas por reserva en efectivo
const MAX_RESERVAS_POR_FUNCION = 5;

// Combina fecha (YYYY-MM-DD) y hora (HH:MM) en un Date
const toDateTime = (fechaISO, hhmm) => parseFecha(`${fechaISO} ${hhmm}`);
const minutosHasta = (fechaISO, hhmm) => {
  const d = toDateTime(fechaISO, hhmm);
  if (!d) return Infinity;
  return Math.floor((d.getTime() - Date.now()) / 60000);
};

// Generador de número de reserva
const makeReservaNumber = (funcionId, salaId) => {
  const now = new Date();
  const ssmm = (now.getSeconds() * 100 + now.getMinutes()) % 10000;
  const rnd = Math.floor(Math.random() * 90) + 10;
  const base = (Number(funcionId) * 1e7) + (Number(salaId) * 1e5);
  return base + (ssmm * 100) + rnd;
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
  sinopsis: m.sinopsis ?? m.descripcion ?? m.resumen ?? null,
});

const normFuncion = (f) => {
  const totalSeats = Number(f.totalSeats ?? f.TOTALSEATS ?? 0);
  const vendidos   = Number(f.vendidos   ?? f.VENDIDOS   ?? 0);
  const reservados = Number(f.reservados ?? f.RESERVADOS ?? 0);
  const disponibles= Number(f.disponibles?? f.DISPONIBLES?? 0);
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
    soldOut: disponibles <= 0,
  };
};

const normSeat = (s) => ({
  idFa: s.idFa,
  fila: String(s.fila),
  col: Number(s.columna),
  estado: String(s.estado || '').toUpperCase(),
  bloqueadoHasta: s.bloqueado_hasta || null,
});

const seatKey = (s) => `${s.fila}-${s.col}`;

/* ================== Componente ================== */
export default function DashboardCliente() {
  const navigate = useNavigate();

  // Estado general
  const [peliculas, setPeliculas] = useState([]);
  const [cargandoPeliculas, setCargandoPeliculas] = useState(true);
  const [query, setQuery] = useState('');
  const [cat, setCat] = useState('ALL');

  // Modal y selección
  const [modalOpen, setModalOpen] = useState(false);
  const [peliculaSel, setPeliculaSel] = useState(null);
  const [funciones, setFunciones] = useState([]);
  const [funcionSel, setFuncionSel] = useState(null);

  // Asientos
  const [loadingSeats, setLoadingSeats] = useState(false);
  const [seats, setSeats] = useState([]);
  const [seleccionados, setSeleccionados] = useState([]);

  // Pago
  const [submitting, setSubmitting] = useState(false);

  // Alertas elegantes
  const [alert, setAlert] = useState({ show: false, message: '', type: 'success' });

  // Regla: cerrar reservas 1h antes del inicio
  const reservaCerrada = useMemo(() => {
    if (!funcionSel) return false;
    return minutosHasta(funcionSel.fecha, funcionSel.horaInicio) < 60;
  }, [funcionSel]);

  /* Cargar cartelera */
  useEffect(() => {
    (async () => {
      try {
        const { data } = await get('/api/cliente/cartelera');
        setPeliculas(Array.isArray(data) ? data.map(normMovie) : []);
        // cache local para Welcome
        try {
          const arr = Array.isArray(data) ? data : [];
          localStorage.setItem('mf_peliculas', JSON.stringify(arr));
          localStorage.setItem('mf_cartelera', JSON.stringify(arr));
        } catch {}
      } catch {
        setPeliculas([]);
      } finally {
        setCargandoPeliculas(false);
      }
    })();
  }, []);

  const categorias = useMemo(
    () => ['ALL', ...new Set(peliculas.map((p) => p.genero).filter(Boolean))],
    [peliculas]
  );

  const listFiltrada = useMemo(() => {
    const q = query.trim().toLowerCase();
    return peliculas.filter((p) => {
      if (cat !== 'ALL' && (p.genero ?? '') !== cat) return false;
      if (!q) return true;
      return (p.titulo ?? '').toLowerCase().includes(q);
    });
  }, [peliculas, query, cat]);

  /* Helpers asientos */
  const ordenarYSetear = (arr) => {
    const a = [...arr];
    a.sort((x, y) => (x.fila === y.fila ? x.col - y.col : x.fila.localeCompare(y.fila)));
    setSeats(a);
  };

  const cargarAsientos = async (funcionId) => {
    setLoadingSeats(true);
    try {
      const { data } = await get(`/api/cliente/funciones/${funcionId}/asientos`);
      ordenarYSetear(Array.isArray(data) ? data.map(normSeat) : []);
    } catch {
      setSeats([]);
    } finally {
      setLoadingSeats(false);
    }
  };

  /* Abrir modal -> funciones */
  const abrirModal = async (pelicula) => {
    setPeliculaSel(pelicula);
    setModalOpen(true);
    setSeleccionados([]);
    setFuncionSel(null);
    setSeats([]);
    try {
      const { data } = await get(`/api/cliente/cartelera/${pelicula.id}/funciones`);
      setFunciones(Array.isArray(data) ? data.map(normFuncion) : []);
    } catch {
      setFunciones([]);
    }
  };

  const cerrarModal = () => setModalOpen(false);

  /* Elegir función -> asientos */
  const seleccionarFuncion = async (f) => {
    setFuncionSel(f);
    setSeleccionados([]);
    // Nueva regla: liberar reservas vencidas para evitar asientos "fantasma"
    try {
      await post(`/api/cliente/funciones/${f.id}/liberar-reservas-vencidas`, {});
    } catch { /* opcional: log */ }
    await cargarAsientos(f.id);
  };

  /* Mapa */
  const filas = useMemo(() => Array.from(new Set(seats.map((s) => s.fila))), [seats]);
  const maxCols = useMemo(() => {
    let m = 0; seats.forEach((s) => { if (s.col > m) m = s.col; });
    return m || 10;
  }, [seats]);

  // Selección con límite
  const toggleSeat = (s) => {
    const ocupado = s.estado === 'RESERVADO' || s.estado === 'VENDIDO';
    const bloqueado = s.estado === 'BLOQUEADO' || !!s.bloqueadoHasta;
    if (ocupado || bloqueado) return;
    const key = seatKey(s);
    setSeleccionados((prev) => {
      const ya = prev.includes(key);
      if (ya) return prev.filter((k) => k !== key);
      if (prev.length >= MAX_RESERVAS_POR_FUNCION) {
        mostrarAlerta(`Solo puedes reservar ${MAX_RESERVAS_POR_FUNCION} asientos por función.`, 'warning');
        return prev;
      }
      return [...prev, key];
    });
  };

  /* Totales */
  const precioUnit = Number(funcionSel?.precio || 0);
  const subtotal = precioUnit * seleccionados.length;
  const total = subtotal;

  /* IDs de asientos (ID_FA) */
  const selectedSeatIds = useMemo(() => {
    const map = new Map(seats.map((s) => [seatKey(s), s.idFa]));
    return seleccionados.map((k) => map.get(k)).filter(Boolean);
  }, [seats, seleccionados]);

  // Función para mostrar alertas elegantes
  const mostrarAlerta = (message, type = 'success') => {
    setAlert({ show: true, message, type });
    setTimeout(() => {
      setAlert({ show: false, message: '', type: 'success' });
    }, 5000);
  };

  const mostrarError = (err) => {
    let msg = 'Ocurrió un error. Intenta nuevamente.';
    if (err?.response) {
      const { status, data } = err.response;
      const serverMsg = data?.message || data?.msg || data?.error || JSON.stringify(data);
      msg = `(${status}) ${serverMsg}`;
    } else if (err?.message) {
      msg = err.message;
    }
    mostrarAlerta(msg, 'error');
  };

  const confirmarReserva = async () => {
    if (!funcionSel || selectedSeatIds.length === 0) return;

    // Reglas: bloqueo por 1h y límite de 5
    if (reservaCerrada) {
      mostrarAlerta('Las reservas se cierran 1 hora antes del inicio de la función.', 'warning');
      return;
    }
    if (selectedSeatIds.length > MAX_RESERVAS_POR_FUNCION) {
      mostrarAlerta(`Máximo ${MAX_RESERVAS_POR_FUNCION} asientos por reserva.`, 'warning');
      return;
    }

    setSubmitting(true);
    try {
      const idemKey = makeIdemKey();
      const numeroReserva = makeReservaNumber(funcionSel.id, funcionSel.salaId);
      
      await post(`/api/cliente/funciones/${funcionSel.id}/reservar`, {
        asientos: selectedSeatIds,
        idemKey,
        numeroReserva,
      });

      mostrarAlerta('¡Reserva realizada con éxito! 🎉 Tienes hasta 1 hora antes del inicio de la función para pagar en taquilla.', 'success');
      
      // Recargar asientos
      await cargarAsientos(funcionSel.id);
      setSeleccionados([]);
    } catch (e) {
      console.error('Confirmar reserva ->', e);
      mostrarError(e);
    } finally {
      setSubmitting(false);
    }
  };

  const imgUrl = (p) =>
    p.poster && !p.poster.startsWith('http') ? `${API_BASE}${p.poster}` : p.poster;

  /* ================== RENDER ================== */
  return (
    <div className="db-container">
      <style>{`
        /* ======= ESTILOS PRINCIPALES MEJORADOS ======= */
        * {
          box-sizing: border-box;
        }
        
        .db-container {
          min-height: 100vh;
          background: linear-gradient(135deg, #0f172a 0%, #1e293b 100%);
          color: white;
          font-family: system-ui, -apple-system, sans-serif;
          overflow-x: hidden;
          padding: 0;
          margin: 0;
          width: 100vw;
          height: 100vh;
          display: flex;
          flex-direction: column;
        }

        /* Alertas elegantes */
        .db-alert {
          position: fixed;
          top: 100px;
          right: 20px;
          z-index: 3000;
          min-width: 350px;
          max-width: 500px;
          background: linear-gradient(135deg, #1e293b 0%, #0f172a 100%);
          border: 1px solid;
          border-radius: 16px;
          padding: 1.25rem;
          box-shadow: 0 20px 40px rgba(0,0,0,0.5);
          backdrop-filter: blur(20px);
          transform: translateX(400px);
          transition: all 0.5s cubic-bezier(0.68, -0.55, 0.265, 1.55);
          display: flex;
          align-items: flex-start;
          gap: 1rem;
        }

        .db-alert.show {
          transform: translateX(0);
        }

        .db-alert.success {
          border-color: #22c55e;
          background: linear-gradient(135deg, rgba(34, 197, 94, 0.1) 0%, #1e293b 100%);
        }

        .db-alert.warning {
          border-color: #f59e0b;
          background: linear-gradient(135deg, rgba(245, 158, 11, 0.1) 0%, #1e293b 100%);
        }

        .db-alert.error {
          border-color: #ef4444;
          background: linear-gradient(135deg, rgba(239, 68, 68, 0.1) 0%, #1e293b 100%);
        }

        .db-alert-icon {
          font-size: 1.5rem;
          flex-shrink: 0;
          margin-top: 0.1rem;
        }

        .db-alert-content {
          flex: 1;
        }

        .db-alert-title {
          font-weight: 700;
          margin-bottom: 0.5rem;
          font-size: 1rem;
        }

        .db-alert.success .db-alert-title {
          color: #22c55e;
        }

        .db-alert.warning .db-alert-title {
          color: #f59e0b;
        }

        .db-alert.error .db-alert-title {
          color: #ef4444;
        }

        .db-alert-message {
          font-size: 0.9rem;
          line-height: 1.4;
          color: #cbd5e1;
        }

        .db-alert-close {
          background: none;
          border: none;
          color: #94a3b8;
          font-size: 1.2rem;
          cursor: pointer;
          padding: 0;
          width: 24px;
          height: 24px;
          display: flex;
          align-items: center;
          justify-content: center;
          transition: all 0.3s ease;
        }

        .db-alert-close:hover {
          color: white;
          transform: scale(1.1);
        }

        /* Topbar mejorado */
        .db-topbar {
          background: rgba(15, 23, 42, 0.98);
          backdrop-filter: blur(15px);
          border-bottom: 1px solid rgba(255,255,255,0.1);
          padding: 0.75rem 0;
          position: sticky;
          top: 0;
          z-index: 1000;
          flex-shrink: 0;
        }

        .db-topbar-inner {
          max-width: 100%;
          margin: 0 auto;
          padding: 0 1.5rem;
          display: flex;
          align-items: center;
          justify-content: space-between;
        }

        .db-brand {
          display: flex;
          align-items: center;
          gap: 0.5rem;
          font-size: 1.25rem;
          font-weight: 800;
          cursor: pointer;
          background: linear-gradient(135deg, #fbbf24 0%, #f59e0b 100%);
          -webkit-background-clip: text;
          -webkit-text-fill-color: transparent;
        }

        .db-actions {
          display: flex;
          gap: 0.75rem;
        }

        .db-action {
          background: rgba(255,255,255,0.05);
          border: 1px solid rgba(255,255,255,0.1);
          color: #cbd5e1;
          padding: 0.4rem 0.8rem;
          border-radius: 6px;
          cursor: pointer;
          transition: all 0.3s ease;
          font-size: 0.85rem;
        }

        .db-action:hover {
          background: rgba(255,255,255,0.1);
          color: white;
        }

        /* Contenido principal con scroll suave */
        .db-main-content {
          flex: 1;
          overflow-y: auto;
          overflow-x: hidden;
          scroll-behavior: smooth;
          -webkit-overflow-scrolling: touch;
        }

        /* Header mejorado */
        .db-header {
          text-align: center;
          padding: 2rem 1rem;
          background: linear-gradient(135deg, rgba(30, 41, 59, 0.9) 0%, rgba(15, 23, 42, 0.95) 100%);
          flex-shrink: 0;
        }

        .db-title {
          font-size: 2.5rem;
          font-weight: 800;
          margin: 0 0 1rem 0;
          background: linear-gradient(135deg, #fff 0%, #fbbf24 100%);
          -webkit-background-clip: text;
          -webkit-text-fill-color: transparent;
        }

        .db-subtitle {
          font-size: 1.1rem;
          opacity: 0.9;
          margin: 0;
          color: #cbd5e1;
          max-width: 600px;
          margin: 0 auto;
          line-height: 1.5;
        }

        /* Buscador mejorado */
        .db-search-section {
          max-width: 900px;
          margin: 0 auto 2rem;
          padding: 0 1.5rem;
          flex-shrink: 0;
        }

        .db-search-bar {
          display: flex;
          gap: 1rem;
          background: rgba(255,255,255,0.05);
          border: 1px solid rgba(255,255,255,0.1);
          border-radius: 16px;
          padding: 1rem;
          backdrop-filter: blur(10px);
        }

        .db-input {
          flex: 1;
          background: rgba(255,255,255,0.1);
          border: 1px solid rgba(255,255,255,0.2);
          border-radius: 10px;
          padding: 0.75rem 1rem;
          color: white;
          font-size: 0.95rem;
          transition: all 0.3s ease;
        }

        .db-input:focus {
          outline: none;
          border-color: #f59e0b;
          box-shadow: 0 0 0 2px rgba(245, 158, 11, 0.2);
        }

        .db-input::placeholder {
          color: #94a3b8;
        }

        .db-select {
          background: rgba(255,255,255,0.1);
          border: 1px solid rgba(255,255,255,0.2);
          border-radius: 10px;
          padding: 0.75rem 1rem;
          color: white;
          min-width: 180px;
          font-size: 0.95rem;
          cursor: pointer;
        }

        .db-btn {
          background: linear-gradient(135deg, #f59e0b 0%, #d97706 100%);
          border: none;
          border-radius: 10px;
          padding: 0.75rem 1.5rem;
          color: white;
          font-weight: 600;
          cursor: pointer;
          transition: all 0.3s ease;
          font-size: 0.95rem;
          white-space: nowrap;
        }

        .db-btn:hover {
          transform: translateY(-2px);
          box-shadow: 0 8px 20px rgba(245, 158, 11, 0.4);
        }

        .db-btn:disabled {
          opacity: 0.6;
          cursor: not-allowed;
          transform: none;
        }

        /* Grid de películas - MEJORADO PARA PANTALLA COMPLETA */
        .db-grid-section {
          flex: 1;
          overflow-y: auto;
          padding-bottom: 2rem;
        }

        .db-grid {
          max-width: 1400px;
          margin: 0 auto;
          padding: 0 1.5rem;
          display: grid;
          grid-template-columns: repeat(auto-fill, minmax(220px, 1fr));
          gap: 1.25rem;
          align-items: start;
        }

        .db-card {
          background: linear-gradient(135deg, rgba(255,255,255,0.05) 0%, rgba(255,255,255,0.02) 100%);
          border: 1px solid rgba(255,255,255,0.1);
          border-radius: 16px;
          overflow: hidden;
          cursor: pointer;
          transition: all 0.3s ease;
          backdrop-filter: blur(10px);
          height: 100%;
          display: flex;
          flex-direction: column;
          position: relative;
        }

        .db-card:hover {
          transform: translateY(-5px);
          border-color: rgba(245, 158, 11, 0.4);
          box-shadow: 0 12px 30px rgba(0,0,0,0.4);
        }

        .db-poster {
          width: 100%;
          height: 300px;
          background-size: cover;
          background-position: center;
          background-repeat: no-repeat;
          position: relative;
          flex-shrink: 0;
        }

        .db-overlay {
          position: absolute;
          inset: 0;
          background: linear-gradient(180deg, rgba(0,0,0,0) 0%, rgba(0,0,0,0.9) 100%);
          display: flex;
          align-items: flex-end;
          padding: 1.25rem;
          opacity: 0;
          transition: all 0.3s ease;
        }

        .db-card:hover .db-overlay {
          opacity: 1;
        }

        .db-overlay-content {
          color: white;
          transform: translateY(10px);
          transition: transform 0.3s ease;
        }

        .db-card:hover .db-overlay-content {
          transform: translateY(0);
        }

        .db-overlay-title {
          font-size: 1.1rem;
          font-weight: 700;
          margin-bottom: 0.5rem;
        }

        .db-overlay-text {
          font-size: 0.8rem;
          opacity: 0.9;
          line-height: 1.4;
          display: -webkit-box;
          -webkit-line-clamp: 3;
          -webkit-box-orient: vertical;
          overflow: hidden;
        }

        .db-card-content {
          padding: 1.25rem;
          flex: 1;
          display: flex;
          flex-direction: column;
        }

        .db-card-title {
          font-size: 1.1rem;
          font-weight: 700;
          margin: 0 0 0.75rem 0;
          color: white;
          line-height: 1.3;
          min-height: 2.6rem;
          display: -webkit-box;
          -webkit-line-clamp: 2;
          -webkit-box-orient: vertical;
          overflow: hidden;
        }

        .db-badges {
          display: flex;
          flex-wrap: wrap;
          gap: 0.4rem;
          margin-top: auto;
        }

        .db-badge {
          background: rgba(255,255,255,0.1);
          border: 1px solid rgba(255,255,255,0.2);
          padding: 0.2rem 0.6rem;
          border-radius: 12px;
          font-size: 0.7rem;
          color: #cbd5e1;
          white-space: nowrap;
        }

        /* Modal mejorado */
        .db-modal {
          position: fixed;
          inset: 0;
          background: rgba(0,0,0,0.9);
          backdrop-filter: blur(12px);
          display: flex;
          align-items: center;
          justify-content: center;
          z-index: 2000;
          padding: 1rem;
          overflow-y: auto;
        }

        .db-modal-content {
          background: linear-gradient(135deg, #1e293b 0%, #0f172a 100%);
          border: 1px solid rgba(255,255,255,0.15);
          border-radius: 20px;
          width: 100%;
          max-width: 1100px;
          max-height: 95vh;
          overflow-y: auto;
          position: relative;
          box-shadow: 0 25px 50px rgba(0,0,0,0.5);
        }

        .db-close {
          position: absolute;
          top: 1rem;
          right: 1rem;
          background: rgba(255,255,255,0.1);
          border: none;
          border-radius: 10px;
          width: 40px;
          height: 40px;
          color: white;
          cursor: pointer;
          z-index: 1;
          display: flex;
          align-items: center;
          justify-content: center;
          font-size: 1.3rem;
          transition: all 0.3s ease;
        }

        .db-close:hover {
          background: rgba(255,255,255,0.2);
          transform: scale(1.1);
        }

        .db-modal-header {
          padding: 1.5rem 2rem 1rem;
          border-bottom: 1px solid rgba(255,255,255,0.1);
        }

        .db-modal-title {
          font-size: 1.75rem;
          font-weight: 700;
          margin: 0 0 0.5rem 0;
          color: white;
        }

        .db-modal-subtitle {
          color: #94a3b8;
          margin: 0;
          font-size: 0.95rem;
        }

        .db-modal-body {
          padding: 1.5rem 2rem 2rem;
          display: grid;
          grid-template-columns: 1fr 1fr;
          gap: 2rem;
        }

        /* Horarios mejorados */
        .db-showtimes {
          background: rgba(255,255,255,0.05);
          border-radius: 16px;
          padding: 1.5rem;
        }

        .db-showtimes-title {
          font-size: 1.2rem;
          font-weight: 700;
          margin: 0 0 1rem 0;
          color: white;
        }

        .db-slot-list {
          display: flex;
          flex-direction: column;
          gap: 0.75rem;
        }

        .db-slot {
          background: rgba(255,255,255,0.05);
          border: 1px solid rgba(255,255,255,0.1);
          border-radius: 12px;
          padding: 1rem;
          cursor: pointer;
          transition: all 0.3s ease;
          display: flex;
          justify-content: space-between;
          align-items: center;
        }

        .db-slot:hover {
          background: rgba(255,255,255,0.1);
          border-color: rgba(245, 158, 11, 0.4);
          transform: translateX(5px);
        }

        .db-slot.selected {
          background: rgba(245, 158, 11, 0.2);
          border-color: #f59e0b;
          transform: translateX(0);
        }

        .db-slot.soldout {
          opacity: 0.5;
          cursor: not-allowed;
        }

        .db-slot-time {
          font-weight: 700;
          color: white;
          font-size: 1rem;
        }

        .db-slot-info {
          font-size: 0.8rem;
          color: #94a3b8;
          line-height: 1.4;
        }

        .db-slot-price {
          font-weight: 700;
          color: #fbbf24;
          font-size: 1rem;
        }

        /* Asientos mejorados */
        .db-seating {
          background: rgba(255,255,255,0.05);
          border-radius: 16px;
          padding: 1.5rem;
        }

        .db-seating-title {
          font-size: 1.2rem;
          font-weight: 700;
          margin: 0 0 1rem 0;
          color: white;
        }

        .db-legend {
          display: flex;
          flex-wrap: wrap;
          gap: 1rem;
          margin-bottom: 1rem;
          font-size: 0.8rem;
        }

        .db-legend-item {
          display: flex;
          align-items: center;
          gap: 0.5rem;
        }

        .db-seats-grid {
          display: grid;
          gap: 0.4rem;
          margin-bottom: 1.5rem;
          justify-content: center;
        }

        .db-seat {
          width: 32px;
          height: 32px;
          border-radius: 6px;
          display: flex;
          align-items: center;
          justify-content: center;
          font-size: 0.7rem;
          font-weight: 600;
          cursor: pointer;
          transition: all 0.2s ease;
        }

        .db-seat.available {
          background: rgba(34, 197, 94, 0.2);
          border: 1px solid #22c55e;
          color: #22c55e;
        }

        .db-seat.available:hover {
          background: rgba(34, 197, 94, 0.3);
          transform: scale(1.1);
        }

        .db-seat.selected {
          background: #f59e0b;
          border: 1px solid #f59e0b;
          color: white;
          transform: scale(1.1);
        }

        .db-seat.reserved {
          background: rgba(59, 130, 246, 0.2);
          border: 1px solid #3b82f6;
          color: #3b82f6;
        }

        .db-seat.occupied {
          background: rgba(239, 68, 68, 0.2);
          border: 1px solid #ef4444;
          color: #ef4444;
          cursor: not-allowed;
        }

        .db-seat.blocked {
          background: rgba(100, 116, 139, 0.2);
          border: 1px solid #64748b;
          color: #64748b;
          cursor: not-allowed;
        }

        .db-screen {
          text-align: center;
          padding: 1rem;
          background: rgba(255,255,255,0.1);
          border-radius: 8px;
          margin-bottom: 1rem;
          font-weight: 700;
          color: #fbbf24;
          font-size: 0.9rem;
          letter-spacing: 2px;
        }

        .db-summary {
          background: rgba(255,255,255,0.05);
          border-radius: 12px;
          padding: 1.25rem;
          margin-bottom: 1rem;
        }

        .db-summary-item {
          display: flex;
          justify-content: space-between;
          margin-bottom: 0.5rem;
          font-size: 0.9rem;
        }

        .db-total {
          font-size: 1.1rem;
          font-weight: 700;
          color: #fbbf24;
          border-top: 1px solid rgba(255,255,255,0.1);
          padding-top: 0.75rem;
          margin-top: 0.75rem;
        }

        /* Estados vacíos mejorados */
        .db-empty {
          text-align: center;
          padding: 3rem 2rem;
          color: #64748b;
          grid-column: 1 / -1;
        }

        .db-empty-icon {
          font-size: 4rem;
          margin-bottom: 1rem;
          opacity: 0.7;
        }

        /* Scrollbar personalizado */
        .db-main-content::-webkit-scrollbar,
        .db-modal-content::-webkit-scrollbar {
          width: 6px;
        }

        .db-main-content::-webkit-scrollbar-track,
        .db-modal-content::-webkit-scrollbar-track {
          background: rgba(255,255,255,0.05);
          border-radius: 3px;
        }

        .db-main-content::-webkit-scrollbar-thumb,
        .db-modal-content::-webkit-scrollbar-thumb {
          background: rgba(245, 158, 11, 0.5);
          border-radius: 3px;
        }

        .db-main-content::-webkit-scrollbar-thumb:hover,
        .db-modal-content::-webkit-scrollbar-thumb:hover {
          background: rgba(245, 158, 11, 0.7);
        }

        /* Responsive mejorado para pantalla completa */
        @media (max-width: 1200px) {
          .db-grid {
            grid-template-columns: repeat(auto-fill, minmax(200px, 1fr));
            gap: 1rem;
          }
        }

        @media (max-width: 768px) {
          .db-alert {
            min-width: 300px;
            right: 10px;
            left: 10px;
          }
          
          .db-modal-body {
            grid-template-columns: 1fr;
            gap: 1.5rem;
            padding: 1rem 1.5rem 1.5rem;
          }
          
          .db-search-bar {
            flex-direction: column;
          }
          
          .db-grid {
            grid-template-columns: repeat(auto-fill, minmax(160px, 1fr));
            gap: 0.8rem;
            padding: 0 1rem;
          }
          
          .db-poster {
            height: 250px;
          }
          
          .db-modal-header {
            padding: 1rem 1.5rem 0.5rem;
          }
          
          .db-topbar-inner {
            padding: 0 1rem;
          }
          
          .db-search-section {
            padding: 0 1rem;
          }
        }

        @media (max-width: 480px) {
          .db-alert {
            min-width: 280px;
            padding: 1rem;
          }
          
          .db-grid {
            grid-template-columns: repeat(auto-fill, minmax(140px, 1fr));
            gap: 0.6rem;
          }
          
          .db-poster {
            height: 200px;
          }
          
          .db-card-content {
            padding: 1rem;
          }
          
          .db-card-title {
            font-size: 0.95rem;
            min-height: 2.4rem;
          }
          
          .db-badge {
            font-size: 0.65rem;
            padding: 0.15rem 0.5rem;
          }
          
          .db-brand {
            font-size: 1.1rem;
          }
          
          .db-action {
            padding: 0.3rem 0.6rem;
            font-size: 0.8rem;
          }
          
          .db-title {
            font-size: 2rem;
          }
          
          .db-subtitle {
            font-size: 0.9rem;
          }
        }

        @media (max-height: 700px) {
          .db-header {
            padding: 1.5rem 1rem;
          }
          
          .db-title {
            font-size: 2rem;
          }
          
          .db-search-section {
            margin-bottom: 1rem;
          }
          
          .db-grid {
            padding-bottom: 1rem;
          }
        }
      `}</style>

      {/* Alertas Elegantes */}
      {alert.show && (
        <div className={`db-alert ${alert.type} ${alert.show ? 'show' : ''}`}>
          <div className="db-alert-icon">
            {alert.type === 'success' && '✅'}
            {alert.type === 'warning' && '⚠️'}
            {alert.type === 'error' && '❌'}
          </div>
          <div className="db-alert-content">
            <div className="db-alert-title">
              {alert.type === 'success' && '¡Éxito!'}
              {alert.type === 'warning' && 'Advertencia'}
              {alert.type === 'error' && 'Error'}
            </div>
            <div className="db-alert-message">{alert.message}</div>
          </div>
          <button 
            className="db-alert-close"
            onClick={() => setAlert({ show: false, message: '', type: 'success' })}
          >
            ×
          </button>
        </div>
      )}

      {/* Topbar */}
      <div className="db-topbar">
        <div className="db-topbar-inner">
          <div className="db-brand" onClick={() => navigate('/welcome-cliente')}>
            <span>🎬</span>
            <span>MovieFlow</span>
          </div>
          <div className="db-actions">
            <button className="db-action" onClick={() => navigate('/welcome-cliente')}>
              Inicio
            </button>
            <button className="db-action" onClick={() => navigate('/reservar-evento')}>
              Eventos
            </button>
          </div>
        </div>
      </div>

      {/* Contenido principal con scroll mejorado */}
      <div className="db-main-content">
        {/* Header */}
        <div className="db-header">
          <h1 className="db-title">CARTELERA</h1>
          <p className="db-subtitle">Elige tu película favorita y reserva tus asientos en segundos.</p>
        </div>

        {/* Buscador */}
        <section className="db-search-section">
          <div className="db-search-bar">
            <input
              type="text"
              className="db-input"
              placeholder="Buscar película..."
              value={query}
              onChange={(e) => setQuery(e.target.value)}
            />
            <select
              className="db-select"
              value={cat}
              onChange={(e) => setCat(e.target.value)}
            >
              {categorias.map((c) => (
                <option key={c} value={c}>
                  {c === 'ALL' ? 'Todas las categorías' : c}
                </option>
              ))}
            </select>
            <button className="db-btn">Buscar</button>
          </div>
        </section>

        {/* Grid de películas */}
        <section className="db-grid-section">
          <div className="db-grid">
            {cargandoPeliculas &&
              Array.from({ length: 8 }).map((_, i) => (
                <article key={`sk-${i}`} className="db-card">
                  <div 
                    className="db-poster" 
                    style={{ background: 'linear-gradient(45deg, #334155, #475569)' }}
                  />
                  <div className="db-card-content">
                    <div style={{background: '#334155', height: '18px', borderRadius: '4px', marginBottom: '0.5rem'}}></div>
                    <div style={{background: '#475569', height: '14px', borderRadius: '4px', width: '70%'}}></div>
                  </div>
                </article>
              ))}
            
            {!cargandoPeliculas && listFiltrada.map((p) => (
              <article key={p.id} className="db-card" onClick={() => abrirModal(p)}>
                <div
                  className="db-poster"
                  style={{
                    backgroundImage: imgUrl(p)
                      ? `url('${imgUrl(p)}')`
                      : 'linear-gradient(45deg, #5b8bd4, #2c3e94)',
                  }}
                >
                  <div className="db-overlay">
                    <div className="db-overlay-content">
                      <div className="db-overlay-title">{p.titulo}</div>
                      <div className="db-overlay-text">
                        {p.sinopsis || 'Disfruta de esta increíble película en nuestra sala.'}
                      </div>
                    </div>
                  </div>
                </div>
                <div className="db-card-content">
                  <h3 className="db-card-title">{p.titulo}</h3>
                  <div className="db-badges">
                    <span className="db-badge">⏱ {p.duracion ?? '--'} min</span>
                    {p.clasificacion && <span className="db-badge">🔖 {p.clasificacion}</span>}
                    {p.genero && <span className="db-badge">🎭 {p.genero}</span>}
                    {p.idioma && <span className="db-badge">🗣 {p.idioma}</span>}
                  </div>
                </div>
              </article>
            ))}
          </div>

          {!cargandoPeliculas && listFiltrada.length === 0 && (
            <div className="db-empty">
              <div className="db-empty-icon">🎬</div>
              <h3 style={{marginBottom: '0.5rem', color: '#cbd5e1'}}>No hay películas que coincidan</h3>
              <p style={{color: '#94a3b8', fontSize: '0.9rem'}}>
                Intenta con otros términos de búsqueda o categorías
              </p>
            </div>
          )}
        </section>
      </div>

      {/* Modal de funciones/reserva */}
      {modalOpen && (
        <div className="db-modal" onClick={cerrarModal}>
          <div className="db-modal-content" onClick={(e) => e.stopPropagation()}>
            <button className="db-close" onClick={cerrarModal}>×</button>

            <div className="db-modal-header">
              <h2 className="db-modal-title">{peliculaSel?.titulo}</h2>
              <p className="db-modal-subtitle">
                {peliculaSel?.duracion ?? '--'} min 
                {peliculaSel?.genero ? ` • ${peliculaSel.genero}` : ''}
                {peliculaSel?.clasificacion ? ` • ${peliculaSel.clasificacion}` : ''}
              </p>
            </div>

            <div className="db-modal-body">
              {/* Horarios */}
              <aside className="db-showtimes">
                <h3 className="db-showtimes-title">Horarios disponibles</h3>
                <div className="db-slot-list">
                  {funciones.length === 0 && (
                    <div style={{color: '#94a3b8', textAlign: 'center', padding: '2rem'}}>
                      No hay funciones disponibles
                    </div>
                  )}
                  {funciones.map((f) => {
                    const active = funcionSel?.id === f.id;
                    const disabled = !!f.soldOut;
                    return (
                      <button
                        key={f.id}
                        className={`db-slot ${active ? 'selected' : ''} ${disabled ? 'soldout' : ''}`}
                        onClick={() => !disabled && seleccionarFuncion(f)}
                        disabled={disabled}
                      >
                        <div>
                          <div className="db-slot-time">🕐 {f.horaInicio}</div>
                          <div className="db-slot-info">
                            {f.salaNombre} • {formatFechaCorta(f.fecha)}
                            {f.formato && ` • ${f.formato}`}
                          </div>
                        </div>
                        <div className="db-slot-price">{currency(f.precio)}</div>
                      </button>
                    );
                  })}
                </div>
              </aside>

              {/* Asientos y reserva */}
              <main className="db-seating">
                <h3 className="db-seating-title">Selecciona tus asientos</h3>

                {/* Leyenda */}
                <div className="db-legend">
                  <div className="db-legend-item">
                    <div className="db-seat available" style={{width: '18px', height: '18px'}}></div>
                    <span>Disponible</span>
                  </div>
                  <div className="db-legend-item">
                    <div className="db-seat selected" style={{width: '18px', height: '18px'}}></div>
                    <span>Seleccionado</span>
                  </div>
                  <div className="db-legend-item">
                    <div className="db-seat reserved" style={{width: '18px', height: '18px'}}></div>
                    <span>Reservado</span>
                  </div>
                  <div className="db-legend-item">
                    <div className="db-seat occupied" style={{width: '18px', height: '18px'}}></div>
                    <span>Ocupado</span>
                  </div>
                </div>

                {/* Grilla de asientos */}
                {!loadingSeats && !funcionSel && (
                  <div style={{color: '#94a3b8', textAlign: 'center', padding: '2rem'}}>
                    Selecciona un horario para ver los asientos disponibles
                  </div>
                )}
                {loadingSeats && (
                  <div style={{color: '#94a3b8', textAlign: 'center', padding: '2rem'}}>
                    Cargando asientos...
                  </div>
                )}
                {!loadingSeats && funcionSel && (
                  <>
                    <div 
                      className="db-seats-grid" 
                      style={{ gridTemplateColumns: `repeat(${maxCols}, 32px)` }}
                    >
                      {filas.map((fila) => {
                        return Array.from({ length: maxCols }).map((_, i) => {
                          const col = i + 1;
                          const s = seats.find((x) => x.fila === fila && x.col === col);
                          const key = s ? `${s.fila}-${s.col}` : `${fila}-${col}`;
                          if (!s) return <div key={key} />;
                          
                          const isSel = seleccionados.includes(key);
                          const esReservado = s.estado === 'RESERVADO';
                          const esVendido = s.estado === 'VENDIDO';
                          const esBloqueado = s.estado === 'BLOQUEADO' || false;
                          
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
                              className={`db-seat ${state}`}
                              onClick={() => toggleSeat(s)}
                              title={`${s.fila}${s.col}`}
                            >
                              {s.fila}{s.col}
                            </div>
                          );
                        });
                      })}
                    </div>
                    <div className="db-screen">🎬 PANTALLA 🎬</div>
                  </>
                )}

                {/* Resumen */}
                {funcionSel && (
                  <div className="db-summary">
                    <div className="db-summary-item">
                      <span>Película:</span>
                      <span>{peliculaSel?.titulo}</span>
                    </div>
                    <div className="db-summary-item">
                      <span>Horario:</span>
                      <span>{funcionSel.horaInicio} - {formatFechaCorta(funcionSel.fecha)}</span>
                    </div>
                    <div className="db-summary-item">
                      <span>Sala:</span>
                      <span>{funcionSel.salaNombre}</span>
                    </div>
                    <div className="db-summary-item">
                      <span>Asientos:</span>
                      <span>
                        {seleccionados.length > 0
                          ? seleccionados.map((k) => k.replace('-', '')).join(', ')
                          : '—'}
                      </span>
                    </div>
                    <div className="db-summary-item">
                      <span>Cantidad:</span>
                      <span>{seleccionados.length}</span>
                    </div>
                    <div className="db-summary-item db-total">
                      <span>Total:</span>
                      <span>{currency(total)}</span>
                    </div>
                  </div>
                )}

                {/* Botón de reserva */}
                <button
                  className="db-btn"
                  style={{width: '100%', marginTop: '1rem'}}
                  disabled={!funcionSel || seleccionados.length === 0 || submitting || reservaCerrada}
                  onClick={confirmarReserva}
                >
                  {submitting ? 'Procesando...' : reservaCerrada ? 'Reservas Cerradas' : 'Reservar'}
                </button>
                
                {reservaCerrada && (
                  <div style={{color: '#ef4444', textAlign: 'center', marginTop: '0.5rem', fontSize: '0.8rem'}}>
                    Las reservas se cierran 1 hora antes del inicio
                  </div>
                )}
              </main>
            </div>
          </div>
        </div>
      )}
    </div>
  );
}