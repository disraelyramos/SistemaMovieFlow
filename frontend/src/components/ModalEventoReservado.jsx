// src/components/ModalEventoReservado.jsx
import React, { useEffect, useMemo, useState } from 'react';
import axios from 'axios';
import { toast } from 'react-toastify';

const API_BASE =
  import.meta.env?.VITE_API_BASE ||
  import.meta.env?.VITE_API_BASE_URL ||
  import.meta.env?.VITE_API_URL ||
  'http://localhost:3001';

const authHeaders = () => {
  const t = localStorage.getItem('mf_token');
  return t ? { Authorization: `Bearer ${t}` } : {};
};

const toLocalDate = (d) => {
  const p = (n)=>String(n).padStart(2,'0');
  return `${d.getFullYear()}-${p(d.getMonth()+1)}-${p(d.getDate())}`;
};
const toLocalTime = (d) => {
  const p = (n)=>String(n).padStart(2,'0');
  return `${p(d.getHours())}:${p(d.getMinutes())}`;
};
const minsBetween = (a,b) => {
  const [ha,ma] = String(a||'00:00').split(':').map(Number);
  const [hb,mb] = String(b||'00:00').split(':').map(Number);
  return hb*60+mb - (ha*60+ma);
};
const toMinutes = (hhmm='00:00') => {
  const [h,m] = String(hhmm).slice(0,5).split(':').map(Number);
  return (h||0)*60 + (m||0);
};
const fromMinutes = (m=0) => {
  const h = Math.floor(m/60), mm = m%60;
  return `${String(h).padStart(2,'0')}:${String(mm).padStart(2,'0')}`;
};

export default function ModalEventoReservado({
  open,
  onClose,
  salas = [],
  initialDate = '',
  modo = 'crear',         // 'crear' | 'editar'
  registro = null,        // {id,...}
  onGuardado,
  onEliminado,

  // opcionales de navegación (no necesarias):
  onRegistrarPago,        // (idEvento:number) => void
  onVerPdf,               // (idEvento:number) => void
}) {
  const baseDate = useMemo(() => {
    if (initialDate) return new Date(`${initialDate}T10:00:00`);
    const d = new Date(); d.setMinutes(0,0,0); d.setHours(10); return d;
    // eslint-disable-next-line
  }, [initialDate]);

  const [salaId, setSalaId] = useState(salas?.[0]?.id ?? '');
  const [titulo, setTitulo] = useState('');
  const [tipo, setTipo] = useState('');
  const [descripcion, setDescripcion] = useState('');
  const [fecha, setFecha] = useState(toLocalDate(baseDate));
  const [horaInicio, setHoraInicio] = useState(toLocalTime(baseDate));
  const [horaFinal, setHoraFinal] = useState(toLocalTime(new Date(baseDate.getTime()+2*60*60*1000)));
  const [contactoNombre, setContactoNombre] = useState('');
  const [contactoTelefono, setContactoTelefono] = useState('');
  const [contactoEmail, setContactoEmail] = useState('');
  const [personas, setPersonas] = useState('');
  const [guardando, setGuardando] = useState(false);

  // confirm eliminar (para el registro actual)
  const [confirmOpen, setConfirmOpen] = useState(false);

  // lock de horario al editar
  const [lockHorario, setLockHorario] = useState(modo === 'editar');
  useEffect(() => setLockHorario(modo === 'editar'), [modo]);

  // disponibilidad (server-side check light)
  const [chequeando, setChequeando] = useState(false);
  const checkDisponibilidad = async () => {
    try {
      setChequeando(true);
      const duracionMin = Math.max(0, minsBetween(horaInicio, horaFinal));
      const params = new URLSearchParams({
        salaId: String(salaId || ''),
        fecha: String(fecha || ''),
        horaInicio: String(horaInicio || '').slice(0,5),
        duracionMin: String(duracionMin),
      });
      if (registro?.id) params.set('ignoreId', String(registro.id));

      const { data } = await axios.get(
        `${API_BASE}/api/eventos-reservados/disponibilidad?${params.toString()}`,
        { headers: { ...authHeaders() } }
      );
      if (data?.ok === false) {
        toast.warning(data?.reason || 'Horario ocupado');
        return false;
      }
      return true;
    } catch {
      // si no existe, validará la BD
      return true;
    } finally {
      setChequeando(false);
    }
  };

  // Cancelar para el registro actual (se mantiene igual)
  const confirmarCancelacion = async () => {
    if (!(modo === 'editar' && registro?.id)) return;
    await cancelarEventoGenerico(registro.id);
  };

  // Prefill
  useEffect(() => {
    if (modo === 'editar' && registro) {
      setSalaId(registro.salaId ?? salas?.[0]?.id ?? '');
      setTitulo(registro.titulo || '');
      setTipo(registro.tipo || '');
      setDescripcion(registro.descripcion || '');
      setFecha(registro.fecha || toLocalDate(baseDate));
      setHoraInicio((registro.horaInicio || '').slice(0,5) || '10:00');
      setHoraFinal((registro.horaFinal || '').slice(0,5) || '12:00');
      setContactoNombre(registro.contactoNombre || '');
      setContactoTelefono(registro.contactoTelefono || '');
      setContactoEmail(registro.contactoEmail || '');
      setPersonas(
        (registro.personas ?? registro.PERSONAS ?? '') === null
          ? ''
          : String(registro.personas ?? registro.PERSONAS ?? '')
      );
    } else {
      setSalaId(salas?.[0]?.id ?? '');
      setTitulo(''); setTipo(''); setDescripcion('');
      setFecha(toLocalDate(baseDate));
      setHoraInicio(toLocalTime(baseDate));
      setHoraFinal(toLocalTime(new Date(baseDate.getTime()+2*60*60*1000)));
      setContactoNombre(''); setContactoTelefono(''); setContactoEmail('');
      setPersonas('');
    }
    // eslint-disable-next-line
  }, [modo, registro, salas, baseDate]);

  const validar = () => {
    if (!salaId) return 'Selecciona una sala.';
    if (!titulo.trim()) return 'El título es obligatorio.';
    if (!fecha) return 'Selecciona la fecha.';
    if (!horaInicio || !horaFinal) return 'Hora inicio y hora final son obligatorias.';
    if (horaFinal <= horaInicio) return 'La hora final debe ser mayor a la hora inicio.';
    if (String(personas).trim() !== '') {
      const n = Number(personas);
      if (!Number.isFinite(n) || n < 0) return 'La cantidad de personas debe ser un número positivo.';
    }
    return null;
  };

  // ====== PDF helpers ======
  const tryOpenPdf = async (id) => {
    try {
      if (onVerPdf) return onVerPdf(id);
      const res = await axios.get(
        `${API_BASE}/api/eventos-reservados/${id}/pdf`,
        { headers: { ...authHeaders() }, responseType: 'blob' }
      );
      const blob = new Blob([res.data], { type: 'application/pdf' });
      const url = URL.createObjectURL(blob);
      window.open(url, '_blank', 'noopener,noreferrer');
      setTimeout(() => URL.revokeObjectURL(url), 10000);
    } catch {
      toast.info('El PDF de la reserva aún no está habilitado en el backend.');
    }
  };
  const goRegistrarPago = (id) => {
    if (onRegistrarPago) return onRegistrarPago(id);
    toast.info(`Para cobrar en efectivo ve a: Caja > Pagos de Reservas (ID evento: ${id}).`);
  };

  // ====== Vista de disponibilidad ======
  const [showDisp, setShowDisp] = useState(false);
  const [loadingDisp, setLoadingDisp] = useState(false);
  const [ocupados, setOcupados] = useState([]); // [{start,end,label,startHM,endHM}]
  const [libres, setLibres] = useState([]);     // [{start,end,startHM,endHM}]

  const OPEN_MIN = 10*60, CLOSE_MIN = 22*60, BUFFER_MIN = 15;

  const cargarDisponibilidad = async () => {
    if (!salaId || !fecha) {
      toast.warn('Selecciona sala y fecha para ver disponibilidad');
      return;
    }
    setLoadingDisp(true);
    try {
      const params = new URLSearchParams({ fecha });

      // funciones
      const { data: fun } = await axios.get(`${API_BASE}/api/funciones?${params.toString()}`);
      const funciones = (Array.isArray(fun)? fun:[]).filter(f => Number(f.salaId)===Number(salaId));

      // eventos
      const { data: ev } = await axios.get(`${API_BASE}/api/eventos-reservados?${params.toString()}`);
      const eventos = (Array.isArray(ev)? ev:[])
        .filter(e => Number(e.salaId)===Number(salaId))
        .filter(e => (e.estado||'RESERVADO')!=='CANCELADO');

      const ranges = [];
      for (const f of funciones) {
        let a = Math.max(OPEN_MIN, toMinutes(String(f.horaInicio)));
        let b = Math.min(CLOSE_MIN, toMinutes(String(f.horaFinal)));
        if (b> a) ranges.push({start:a, end:b, label:`Función: ${f.peliculaTitulo||''}`.trim()});
      }
      for (const e of eventos) {
        let a = Math.max(OPEN_MIN, toMinutes(String(e.horaInicio)));
        let b = Math.min(CLOSE_MIN, toMinutes(String(e.horaFinal)));
        if (b> a) ranges.push({start:a, end:b, label:`Evento: ${e.titulo||'Reservado'}`});
      }

      ranges.sort((x,y)=>x.start-y.start);
      const merged = [];
      for (const r of ranges) {
        if (!merged.length || r.start > merged[merged.length-1].end) {
          merged.push({...r});
        } else {
          merged[merged.length-1].end = Math.max(merged[merged.length-1].end, r.end);
        }
      }
      setOcupados(merged.map(r => ({...r, startHM: fromMinutes(r.start), endHM: fromMinutes(r.end)})));

      const free = [];
      let cursor = OPEN_MIN;
      for (const r of merged) {
        const nextEndWithBuffer = r.end + BUFFER_MIN;
        if (r.start - cursor >= 1) {
          free.push({start: cursor, end: r.start, startHM: fromMinutes(cursor), endHM: fromMinutes(r.start)});
        }
        cursor = Math.max(cursor, nextEndWithBuffer);
      }
      if (CLOSE_MIN - cursor >= 1) {
        free.push({start: cursor, end: CLOSE_MIN, startHM: fromMinutes(cursor), endHM: fromMinutes(CLOSE_MIN)});
      }
      setLibres(free);
      setShowDisp(true);
    } catch (e) {
      toast.error('No se pudo cargar la disponibilidad.');
    } finally {
      setLoadingDisp(false);
    }
  };

  // ====== Apartado NUEVO: Reservas del día para esta sala ======
  const [showReservas, setShowReservas] = useState(false);
  const [loadingReservas, setLoadingReservas] = useState(false);
  const [reservas, setReservas] = useState([]); // [{id, salaId, titulo, horaInicio, horaFinal, personas, estado}]

  const cargarReservas = async () => {
    if (!salaId || !fecha) {
      toast.warn('Selecciona sala y fecha para ver reservas');
      return;
    }
    setLoadingReservas(true);
    try {
      const params = new URLSearchParams({ fecha });
      const { data } = await axios.get(`${API_BASE}/api/eventos-reservados?${params.toString()}`, { headers: { ...authHeaders() }});
      const list = (Array.isArray(data) ? data : [])
        .filter(e => Number(e.SALA_ID ?? e.salaId) === Number(salaId))
        .map(e => ({
          id: Number(e.ID_EVENTO ?? e.idEvento ?? e.id ?? 0),
          titulo: e.NOTAS || e.titulo || 'Evento',
          startTs: e.START_TS ?? e.startTs,
          endTs: e.END_TS ?? e.endTs,
          personas: e.PERSONAS ?? e.personas ?? null,
          estado: e.ESTADO ?? e.estado ?? 'RESERVADO',
          salaNombre: e.SALA_NOMBRE ?? e.salaNombre ?? ''
        }));
      // ordenar por inicio
      list.sort((a,b) => new Date(a.startTs) - new Date(b.startTs));
      setReservas(list);
      setShowReservas(true);
    } catch {
      toast.error('No se pudieron cargar las reservas.');
    } finally {
      setLoadingReservas(false);
    }
  };

  const cancelarEventoGenerico = async (id) => {
    setGuardando(true);
    try {
      // Primero intentamos con /cancelar (tu ruta actual)
      try {
        await axios.patch(`${API_BASE}/api/eventos-reservados/${id}/cancelar`, {}, { headers: { ...authHeaders() } });
      } catch {
        // Fallback a /cancel si existiera
        await axios.patch(`${API_BASE}/api/eventos-reservados/${id}/cancel`, {}, { headers: { ...authHeaders() } });
      }
      toast.success('Evento cancelado');
      setConfirmOpen(false);
      // refrescar listas locales y notificar al padre
      if (showReservas) await cargarReservas();
      if (showDisp) await cargarDisponibilidad();
      onEliminado?.();
    } catch (e) {
      const msg = e?.response?.data?.message || 'No se pudo cancelar el evento';
      toast.error(msg);
    } finally {
      setGuardando(false);
    }
  };

  const guardar = async () => {
    const err = validar(); if (err) return toast.warn(err);
    const libre = await checkDisponibilidad();
    if (!libre) return;

    setGuardando(true);
    try {
      const duracionMin = Math.max(0, minsBetween(horaInicio, horaFinal));
      const payload = {
        salaId: Number(salaId),
        titulo: titulo.trim(),
        tipo: (tipo || 'Evento').trim(),
        descripcion: descripcion.trim() || null,
        fecha, horaInicio, horaFinal,
        duracionMin,
        contactoNombre: contactoNombre.trim() || null,
        contactoTelefono: contactoTelefono.trim() || null,
        contactoEmail: contactoEmail.trim() || null,
        personas: String(personas).trim() === '' ? null : Number(personas)
      };

      if (modo === 'editar' && registro?.id) {
        await axios.put(
          `${API_BASE}/api/eventos-reservados/${registro.id}`,
          payload,
          { headers: { 'Content-Type': 'application/json', ...authHeaders() } }
        );
        toast.success('Evento actualizado');
        onGuardado?.();
      } else {
        const { data } = await axios.post(
          `${API_BASE}/api/eventos-reservados`,
          payload,
          { headers: { 'Content-Type': 'application/json', ...authHeaders() } }
        );
        toast.success('Evento reservado creado');
        const newId = Number(data?.id ?? data?.ID_EVENTO ?? data?.id_evento ?? data?.eventoId ?? 0) || null;
        if (newId) { await tryOpenPdf(newId); }
        onGuardado?.();
      }
    } catch (e) {
      const msg = e?.response?.data?.message || 'No se pudo guardar el evento';
      toast.error(msg);
    } finally { setGuardando(false); }
  };

  if (!open) return null;

  return (
    <>
      {/* Overlay */}
      <div className="position-fixed top-0 start-0 w-100 h-100 d-flex align-items-center justify-content-center"
           style={{background:'rgba(0,0,0,0.35)', zIndex:1050}} role="dialog" aria-modal="true">
        {/* Contenedor modal con altura limitada y layout en columna */}
        <div
          className="bg-white rounded-3 shadow p-0"
          style={{ width: 'min(980px, 96vw)', maxHeight: '92vh', display: 'flex', flexDirection: 'column' }}
        >
          {/* Header fijo */}
          <div className="p-3 border-bottom d-flex align-items-center justify-content-between">
            <h5 className="m-0">
              <i className="bi bi-calendar-plus me-2" />
              {modo === 'editar' ? 'Editar evento reservado' : 'Nuevo evento reservado'}
            </h5>
            <div className="d-flex align-items-center gap-2">
              {modo === 'editar' && (
                <button
                  type="button"
                  className="btn btn-sm btn-outline-secondary"
                  title={lockHorario ? 'Desbloquear para editar sala/fecha/horas' : 'Bloquear sala/fecha/horas'}
                  onClick={() => setLockHorario(v => !v)}
                >
                  <i className={`bi ${lockHorario ? 'bi-lock' : 'bi-unlock'}`} />
                </button>
              )}
              <button className="btn btn-sm btn-light" onClick={onClose} disabled={guardando || chequeando}>
                <i className="bi bi-x-lg"/>
              </button>
            </div>
          </div>

          {/* Body con SCROLL */}
          <div
            className="p-3"
            style={{ overflowY: 'auto', paddingRight: 12, flex: 1, minHeight: 0 }}
          >
            <div className="row g-3">
              <div className="col-md-6">
                <label className="form-label">Sala</label>
                <select className="form-select" value={salaId}
                        onChange={e=>setSalaId(e.target.value)} disabled={modo==='editar' && lockHorario}>
                  {salas.map(s => <option key={s.id} value={s.id}>{s.nombre}</option>)}
                </select>
              </div>
              <div className="col-md-6">
                <label className="form-label">Tipo de evento (texto libre)</label>
                <input className="form-control" value={tipo} onChange={e=>setTipo(e.target.value)}
                      placeholder="Ej: Graduación, Mantenimiento, Ensayo…" />
              </div>

              <div className="col-12">
                <label className="form-label">Título</label>
                <input className="form-control" value={titulo} onChange={e=>setTitulo(e.target.value)} placeholder="Ej: Graduación" />
              </div>

              <div className="col-12">
                <label className="form-label">Descripción (opcional)</label>
                <textarea className="form-control" rows={3} value={descripcion} onChange={e=>setDescripcion(e.target.value)} />
              </div>

              <div className="col-md-4">
                <label className="form-label">Fecha</label>
                <input type="date" className="form-control" value={fecha}
                      onChange={e=>setFecha(e.target.value)} disabled={modo==='editar' && lockHorario} />
              </div>
              <div className="col-md-4">
                <label className="form-label">Hora inicio</label>
                <input type="time" className="form-control" value={horaInicio}
                      onChange={e=>setHoraInicio(e.target.value)} disabled={modo==='editar' && lockHorario} />
              </div>
              <div className="col-md-4">
                <label className="form-label">Hora final</label>
                <input type="time" className="form-control" value={horaFinal}
                      onChange={e=>setHoraFinal(e.target.value)} disabled={modo==='editar' && lockHorario} />
              </div>

              <div className="col-md-4">
                <label className="form-label">Contacto (Nombre)</label>
                <input className="form-control" value={contactoNombre} onChange={e=>setContactoNombre(e.target.value)} />
              </div>
              <div className="col-md-4">
                <label className="form-label">Contacto (Teléfono)</label>
                <input className="form-control" value={contactoTelefono} onChange={e=>setContactoTelefono(e.target.value)} />
              </div>
              <div className="col-md-4">
                <label className="form-label">Contacto (Email)</label>
                <input type="email" className="form-control" value={contactoEmail} onChange={e=>setContactoEmail(e.target.value)} />
              </div>

              <div className="col-md-4">
                <label className="form-label">Personas (opcional)</label>
                <input
                  type="number"
                  min="0"
                  step="1"
                  className="form-control"
                  value={personas}
                  onChange={(e)=>setPersonas(e.target.value)}
                  placeholder="Ej: 100"
                />
              </div>

              <div className="col-12 small text-muted">
                * El sistema sólo maneja <b>pagos en efectivo</b>. El registro de pago se hace desde Caja.
              </div>

              {/* Disponibilidad */}
              <div className="col-12">
                <div className="d-flex align-items-center justify-content-between">
                  <h6 className="m-0">Disponibilidad (10:00 – 22:00)</h6>
                  <div className="d-flex gap-2">
                    <button className="btn btn-sm btn-outline-primary" onClick={cargarDisponibilidad} disabled={loadingDisp}>
                      {loadingDisp ? 'Cargando…' : 'Ver disponibilidad'}
                    </button>
                    {showDisp && (
                      <button className="btn btn-sm btn-outline-secondary" onClick={()=>setShowDisp(false)}>
                        Ocultar
                      </button>
                    )}
                  </div>
                </div>
                {showDisp && (
                  <div className="mt-2">
                    <div className="small text-muted mb-2">
                      Se consideran funciones y eventos reservados. Se aplica un buffer de 15 min tras cada ocupado.
                    </div>
                    <div className="row g-3">
                      <div className="col-md-6">
                        <div className="card border-0 shadow-sm">
                          <div className="card-body">
                            <div className="fw-bold mb-2">Ocupados</div>
                            {ocupados.length ? (
                              <ul className="mb-0">
                                {ocupados.map((r,idx)=>(
                                  <li key={idx}>
                                    {r.startHM} – {r.endHM} <span className="text-muted">({r.label})</span>
                                  </li>
                                ))}
                              </ul>
                            ) : <div className="text-muted">No hay ocupados.</div>}
                          </div>
                        </div>
                      </div>
                      <div className="col-md-6">
                        <div className="card border-0 shadow-sm">
                          <div className="card-body">
                            <div className="fw-bold mb-2">Libres</div>
                            {libres.length ? (
                              <ul className="mb-0">
                                {libres.map((r,idx)=>(
                                  <li key={idx}>{r.startHM} – {r.endHM}</li>
                                ))}
                              </ul>
                            ) : <div className="text-muted">No hay rangos libres.</div>}
                          </div>
                        </div>
                      </div>
                    </div>
                  </div>
                )}
              </div>

              {/* ===== NUEVO: Reservas de la sala (día) ===== */}
              <div className="col-12">
                <div className="d-flex align-items-center justify-content-between">
                  <h6 className="m-0">Reservas de la sala (día seleccionado)</h6>
                  <div className="d-flex gap-2">
                    <button className="btn btn-sm btn-outline-primary" onClick={cargarReservas} disabled={loadingReservas}>
                      {loadingReservas ? 'Cargando…' : 'Ver reservas del día'}
                    </button>
                    {showReservas && (
                      <button className="btn btn-sm btn-outline-secondary" onClick={()=>setShowReservas(false)}>
                        Ocultar
                      </button>
                    )}
                  </div>
                </div>

                {showReservas && (
                  <div className="mt-2">
                    <div className="table-responsive">
                      <table className="table table-sm align-middle">
                        <thead>
                          <tr>
                            <th style={{whiteSpace:'nowrap'}}>Evento</th>
                            <th>Sala</th>
                            <th>Inicio</th>
                            <th>Fin</th>
                            <th>Personas</th>
                            <th>Estado</th>
                            <th style={{width:220}}>Acción</th>
                          </tr>
                        </thead>
                        <tbody>
                          {reservas.length ? reservas.map((r) => {
                            const ini = new Date(r.startTs);
                            const fin = new Date(r.endTs);
                            const fmt = (d)=> d instanceof Date && !isNaN(d) ? d.toLocaleString() : '-';
                            return (
                              <tr key={r.id}>
                                <td>#{r.id}</td>
                                <td><span className="badge bg-light text-dark">{r.salaNombre || `Sala ${salaId}`}</span></td>
                                <td>{fmt(ini)}</td>
                                <td>{fmt(fin)}</td>
                                <td>{r.personas ?? 0}</td>
                                <td>
                                  <span className="badge" style={{background:'#eef2ff', color:'#4f46e5'}}>
                                    {(r.estado||'RESERVADO').toUpperCase()}
                                  </span>
                                </td>
                                <td className="d-flex gap-2 flex-wrap">
                                  <button className="btn btn-sm btn-outline-dark" onClick={()=>tryOpenPdf(r.id)}>
                                    <i className="bi bi-filetype-pdf me-1" /> PDF
                                  </button>
                                  <button
                                    className="btn btn-sm btn-outline-danger"
                                    onClick={()=>cancelarEventoGenerico(r.id)}
                                    disabled={guardando}
                                  >
                                    <i className="bi bi-x-circle me-1" /> Cancelar
                                  </button>
                                </td>
                              </tr>
                            );
                          }) : (
                            <tr><td colSpan={7} className="text-muted">No hay reservas para esta sala en el día seleccionado.</td></tr>
                          )}
                        </tbody>
                      </table>
                    </div>
                  </div>
                )}
              </div>
              {/* ===== FIN NUEVO ===== */}
            </div>
          </div>

          {/* Footer fijo */}
          <div className="p-3 border-top d-flex justify-content-between flex-wrap gap-2">
            <div className="d-flex gap-2">
              {modo === 'editar' && registro?.id ? (
                <>
                  <button className="btn btn-outline-dark" onClick={() => tryOpenPdf(registro.id)} disabled={guardando || chequeando}>
                    <i className="bi bi-filetype-pdf me-1" /> PDF de reserva
                  </button>
                  <button className="btn btn-success" onClick={() => goRegistrarPago(registro.id)} disabled={guardando || chequeando}>
                    <i className="bi bi-cash-coin me-1" /> Registrar pago (efectivo)
                  </button>
                </>
              ) : null}
            </div>

            <div className="d-flex gap-2 ms-auto">
              {modo === 'editar' ? (
                <button className="btn btn-outline-danger" onClick={() => setConfirmOpen(true)} disabled={guardando || chequeando}>
                  Cancelar evento
                </button>
              ) : null}
              <button className="btn btn-light" onClick={onClose} disabled={guardando || chequeando}>Cerrar</button>
              <button className="btn btn-primary" onClick={guardar} disabled={guardando || chequeando}>
                {chequeando ? 'Verificando…' : guardando ? 'Guardando…' : (modo === 'editar' ? 'Guardar cambios' : 'Guardar evento')}
              </button>
            </div>
          </div>
        </div>
      </div>

      {confirmOpen && (
        <div
          className="position-fixed top-0 start-0 w-100 h-100 d-flex align-items-center justify-content-center"
          style={{ background: 'rgba(0,0,0,0.4)', zIndex: 1060 }}
        >
          <div className="bg-white rounded-3 shadow p-3" style={{ width: 'min(520px, 96vw)' }}>
            <div className="d-flex align-items-start gap-3">
              <div
                className="rounded-circle d-flex align-items-center justify-content-center flex-shrink-0"
                style={{ width: 44, height: 44, background: '#fde2e7' }}
              >
                <i className="bi bi-exclamation-triangle-fill fs-5 text-danger" />
              </div>
              <div className="flex-grow-1">
                <h5 className="mb-1">¿Eliminar este evento?</h5>
                <p className="text-muted mb-3">
                  Se eliminará de la sala y la fecha seleccionadas. Esta acción no se puede deshacer.
                </p>
                <div className="d-flex justify-content-end gap-2">
                  <button className="btn btn-light" onClick={() => setConfirmOpen(false)} disabled={guardando}>
                    Cancelar
                  </button>
                  <button className="btn btn-danger" onClick={() => confirmarCancelacion()} disabled={guardando}>
                    {guardando ? 'Eliminando…' : 'Eliminar'}
                  </button>
                </div>
              </div>
            </div>
          </div>
        </div>
      )}
    </>
  );
}
