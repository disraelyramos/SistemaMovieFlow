// src/pages/AsignarFunciones.jsx
import React, { useEffect, useMemo, useState } from 'react';
import axios from 'axios';
import { toast } from 'react-toastify';
import ModalAsignarFuncion from "../components/ModalAsignarFuncion";
import HoraChip from "../components/HoraChip";
import "../styles/funciones.css";
import ModalFuncionesMasivas from "../components/ModalFuncionesMasivas";
import ModalEventoReservado from "../components/ModalEventoReservado";

const API_BASE = import.meta.env?.VITE_API_BASE_URL || 'http://localhost:3001';

/* ================= Utils (sin cambios de lógica) ================= */
// "HH:MM" -> minutos
const toMinutes = (hhmm = '') => {
  const [h, m] = String(hhmm).split(':').map(Number);
  return (h || 0) * 60 + (m || 0);
};

// Fin de función a Date real (considera overnight)
const endDateOf = (f) => {
  // f.fecha: YYYY-MM-DD, f.horaFinal: HH:MM, f.overnight: boolean
  const [y, m, d] = String(f.fecha).split('-').map(Number);
  const [hh, mm] = String(f.horaFinal).slice(0, 5).split(':').map(Number);
  const dt = new Date(y || 1970, (m || 1) - 1, d || 1, hh || 0, mm || 0, 0, 0);
  if (f.overnight) dt.setDate(dt.getDate() + 1);
  return dt;
};

export default function ProgramarFunciones() {
  /* ================= State ================= */
  const [salas, setSalas] = useState([]);
  const [funciones, setFunciones] = useState([]);
  const [eventos, setEventos] = useState([]);
  const [fechaSeleccionada, setFechaSeleccionada] = useState('');

  const [modalOpen, setModalOpen] = useState(false);
  const [modo, setModo] = useState('crear');
  const [registroActivo, setRegistroActivo] = useState(null);

  const [cargando, setCargando] = useState(false);
  const [reloadKey, setReloadKey] = useState(0);
  const [modalMasivoOpen, setModalMasivoOpen] = useState(false);

  // Eventos (crear/editar)
  const [modalEventoOpen, setModalEventoOpen] = useState(false);
  const [modoEvento, setModoEvento] = useState('crear'); // 'crear' | 'editar'
  const [eventoActivo, setEventoActivo] = useState(null);

  /* ================= Efectos: Salas ================= */
  useEffect(() => {
    (async () => {
      try {
        const { data } = await axios.get(`${API_BASE}/api/funciones/select-data`);
        const arr = (data?.salas || []).map(s => ({
          id: Number(s.id ?? s.ID_SALA ?? s.ID),
          nombre: s.nombre ?? s.NOMBRE,
          capacidad: Number(s.capacidad ?? s.CAPACIDAD ?? 0),
        }));
        setSalas(arr);
      } catch {
        toast.error('No se pudieron cargar las salas');
      }
    })();
  }, []);

  /* ================= Efectos: Funciones ================= */
  useEffect(() => {
    (async () => {
      setCargando(true);
      try {
        const params = new URLSearchParams();
        if (fechaSeleccionada) params.set('fecha', fechaSeleccionada);

        const { data } = await axios.get(
          `${API_BASE}/api/funciones${params.toString() ? `?${params}` : ''}`
        );

        const list = Array.isArray(data)
          ? data.map(f => ({
              kind: 'funcion',
              id: Number(f.id),
              salaId: Number(f.salaId),
              fecha: String(f.fecha),
              horaInicio: String(f.horaInicio).slice(0, 5),
              horaFinal: String(f.horaFinal).slice(0, 5),
              overnight: !!f.overnight,
              titulo: f.peliculaTitulo || '',
              formato: f.formato || '',
              precio: Number(f.precio || 0),
              poster: f.imagenUrl || '',
              // para precargar catálogos en el modal
              peliculaId: Number(f.peliculaId ?? f.idPelicula ?? f.ID_PELICULA ?? 0),
              formatoId: Number(f.formatoId ?? f.idFormato ?? f.ID_FORMATO ?? 0),
              idiomaId: Number(f.idiomaId ?? f.idIdioma ?? f.ID_IDIOMA ?? 0),
            }))
          : [];

        setFunciones(list);
      } catch {
        toast.error('No se pudieron cargar las funciones');
      } finally {
        setCargando(false);
      }
    })();
  }, [fechaSeleccionada, reloadKey]);

  /* ================= Efectos: Eventos ================= */
  useEffect(() => {
    (async () => {
      try {
        const params = new URLSearchParams();
        if (fechaSeleccionada) params.set('fecha', fechaSeleccionada);

        const { data } = await axios.get(
          `${API_BASE}/api/eventos-reservados${params.toString() ? `?${params}` : ''}`
        );

        const list = Array.isArray(data)
          ? data.map(ev => ({
              kind: 'evento',
              id: Number(ev.id),
              salaId: Number(ev.salaId),
              fecha: String(ev.fecha),
              horaInicio: String(ev.horaInicio).slice(0, 5),
              horaFinal: String(ev.horaFinal).slice(0, 5),
              titulo: ev.titulo || 'Evento',
              tipo: ev.tipo || 'Evento',
              estado: ev.estado || 'RESERVADO',
              contactoNombre: ev.contactoNombre || null,
              contactoTelefono: ev.contactoTelefono || null,
              contactoEmail: ev.contactoEmail || null,
              descripcion: ev.descripcion || null,
            }))
          : [];

        // Oculta cancelados
        setEventos(list.filter(e => e.estado !== 'CANCELADO'));
      } catch (e) {
        const msg = e?.response?.data?.message || 'No se pudieron cargar los eventos';
        toast.error(msg);
      }
    })();
  }, [fechaSeleccionada, reloadKey]);

  /* ================= Mezcla por sala (solo render) ================= */
  const itemsPorSala = useMemo(() => {
    const map = new Map();
    salas.forEach(s => map.set(s.id, []));
    [...funciones, ...eventos]
      .filter(it => !fechaSeleccionada || it.fecha === fechaSeleccionada)
      .forEach(it => {
        if (!map.has(it.salaId)) map.set(it.salaId, []);
        map.get(it.salaId).push(it);
      });
    for (const arr of map.values()) {
      arr.sort((a, b) => toMinutes(a.horaInicio) - toMinutes(b.horaInicio));
    }
    return map;
  }, [salas, funciones, eventos, fechaSeleccionada]);

  /* ================= Handlers ================= */
  const abrirVer = (f) => { setModo('editar'); setRegistroActivo(f); setModalOpen(true); };
  const onProgramar = () => { setModalOpen(false); setReloadKey(k => k + 1); };
  const onEliminar  = () => { setModalOpen(false); setReloadKey(k => k + 1); };

  // Evento: crear/editar
  const abrirCrearEvento = () => { setModoEvento('crear'); setEventoActivo(null); setModalEventoOpen(true); };
  const abrirEditarEvento = (ev) => { setModoEvento('editar'); setEventoActivo(ev); setModalEventoOpen(true); };
  const onEventoGuardado = () => { setModalEventoOpen(false); setReloadKey(k => k + 1); };
  const onEventoEliminado = () => { setModalEventoOpen(false); setReloadKey(k => k + 1); };

  /* ================= Temporizador inteligente (sweep) ================= */
  const nextExpiry = useMemo(() => {
    const now = new Date();
    let min = null;
    for (const f of funciones) {
      const end = endDateOf(f);
      if (end > now && (!min || end < min)) min = end;
    }
    return min; // Date | null
  }, [funciones]);

  useEffect(() => {
    if (!nextExpiry) return; // nada por finalizar
    const delay = Math.max(1000, nextExpiry.getTime() - Date.now()); // min 1s
    const id = setTimeout(async () => {
      try {
        const { data } = await axios.post(`${API_BASE}/api/funciones/finalizar-sweep`);
        const n = Number(data?.updated || 0);
        if (n > 0) {
          toast.info(`${n} función(es) finalizadas`);
          setReloadKey(k => k + 1); // recargar funciones/eventos
        }
      } catch {
        /* no romper la UI si falla */
      }
    }, delay);
    return () => clearTimeout(id);
  }, [nextExpiry]);

  /* ================= Render ================= */
  return (
    <div className="container-fluid py-4">
      {/* Filtros / acciones */}
      <div className="mb-4 d-flex align-items-center gap-3 flex-wrap">
        <label className="fw-bold">Seleccionar fecha:</label>
        <input
          type="date"
          className="form-control w-auto"
          value={fechaSeleccionada}
          onChange={(e) => setFechaSeleccionada(e.target.value)}
        />
        <button className="btn btn-success" onClick={() => setModalMasivoOpen(true)}>
          Agregar funciones
        </button>
        <button className="btn btn-primary" onClick={abrirCrearEvento}>
          Agregar eventos
        </button>
        <button
          className="btn btn-outline-secondary btn-mostrar-todas"
          onClick={() => setFechaSeleccionada('')}
          disabled={!fechaSeleccionada}
        >
          Mostrar todas
        </button>
      </div>

      {/* Grid de salas */}
      <div className="grid-salas">
        {salas.map((sala) => {
          const lista = itemsPorSala.get(sala.id) || [];
          return (
            <div key={sala.id} className="sala-card">
              <div className="sala-card__header">
                <div className="d-flex align-items-center">
                  <i className="fas fa-door-open me-2" />
                  {sala.nombre}
                </div>
                <span className="badge bg-light text-dark d-flex align-items-center gap-2 pill-asientos">
                  <i className="fas fa-chair" />
                  {sala.capacidad} asientos
                </span>
              </div>

              <div className="sala-card__body">
                {cargando ? (
                  <div className="text-center text-muted small py-4">Cargando…</div>
                ) : lista.length ? (
                  lista.map(it =>
                    it.kind === 'funcion' ? (
                      <HoraChip
                        key={`f-${it.id}`}
                        date={it.fecha}
                        start={it.horaInicio}
                        end={it.horaFinal}
                        overnight={it.overnight}
                        title={it.titulo}
                        formato={it.formato}
                        price={it.precio}
                        poster={it.poster}
                        onClick={() => abrirVer(it)}
                      />
                    ) : (
                      <HoraChip
                        key={`e-${it.id}`}
                        date={it.fecha}
                        start={it.horaInicio}
                        end={it.horaFinal}
                        title={it.titulo}
                        badgeText={it.tipo}
                        variant="evento"
                        onClick={() => abrirEditarEvento(it)}
                      />
                    )
                  )
                ) : (
                  // Estado vacío (presentacional, sin alterar lógica)
                  <div className="text-center text-muted small py-4 no-funciones">
                    <svg
                      className="claqueta"
                      width="56"
                      height="56"
                      viewBox="0 0 24 24"
                      fill="none"
                      xmlns="http://www.w3.org/2000/svg"
                      aria-hidden="true"
                    >
                      <path d="M3 7h18v4H3V7Z" fill="#cbd5e1"/>
                      <path d="M3 11h18v8a2 2 0 0 1-2 2H5a2 2 0 0 1-2-2v-8Z" fill="#e2e8f0"/>
                      <path d="M6 7l3-4 3 4 3-4 3 4" stroke="#94a3b8" strokeWidth="1.5" strokeLinecap="round"/>
                    </svg>
                    No hay elementos programados
                  </div>
                )}
              </div>
            </div>
          );
        })}
      </div>

      {/* Modales */}
      {modalOpen && (
        <ModalAsignarFuncion
          open={modalOpen}
          onClose={() => setModalOpen(false)}
          modo={modo}
          salas={salas}
          registro={registroActivo}
          onProgramar={onProgramar}
          onEliminar={onEliminar}
        />
      )}

      {modalMasivoOpen && (
        <ModalFuncionesMasivas
          open={modalMasivoOpen}
          onClose={() => setModalMasivoOpen(false)}
          onProgramar={onProgramar}
          initialDate={fechaSeleccionada}
        />
      )}

      {modalEventoOpen && (
        <ModalEventoReservado
          open={modalEventoOpen}
          onClose={() => setModalEventoOpen(false)}
          salas={salas}
          initialDate={fechaSeleccionada}
          modo={modoEvento}
          registro={eventoActivo}
          onGuardado={onEventoGuardado}
          onEliminado={onEventoEliminado}
        />
      )}
    </div>
  );
}
