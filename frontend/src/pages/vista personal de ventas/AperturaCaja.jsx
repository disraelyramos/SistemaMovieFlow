import React, { useState, useEffect } from "react";
import axios from "axios";
import { toast } from "react-toastify";
import { confirmarAccion } from "../../utils/confirmations";
import "react-toastify/dist/ReactToastify.css";
import "../../styles/personal de ventas/aperturaCaja.css";
import VerificarAdmin from "../../components/verificacion/VerificarAdmin";

const API_BASE =
  import.meta?.env?.VITE_API_BASE ||
  import.meta?.env?.VITE_API_BASE_URL ||
  import.meta?.env?.VITE_API_URL ||
  "http://localhost:3001";

/* === Axios con token (mismo patrón del Dashboard) === */
const client = axios.create({ baseURL: API_BASE, withCredentials: false });
client.interceptors.request.use((cfg) => {
  try {
    const t = localStorage.getItem("mf_token");
    if (t) {
      cfg.headers = cfg.headers || {};
      if (!cfg.headers.Authorization) cfg.headers.Authorization = `Bearer ${t}`;
    }
  } catch {}
  return cfg;
});

const AperturaCaja = () => {
  const [caja, setCaja] = useState("");
  const [turno, setTurno] = useState("");
  const [observaciones, setObservaciones] = useState("");
  const [cajas, setCajas] = useState([]);
  const [turnos, setTurnos] = useState([]);
  const [denominaciones, setDenominaciones] = useState([]);
  const [loading, setLoading] = useState(false);

  const [errors, setErrors] = useState({
    caja: false,
    turno: false,
    observaciones: false,
  });

  // 🔒 modal + payload pendiente
  const [showAdminModal, setShowAdminModal] = useState(false);
  const [payloadAperturaPendiente, setPayloadAperturaPendiente] = useState(null);

  // Helper para rotular Q200 / Q0.50 correctamente
  const labelDenom = (v) => {
    const n = Number(v || 0);
    return n >= 1 ? `Q${Math.round(n)}` : `Q${n.toFixed(2)}`;
  };

  // Carga inicial
  useEffect(() => {
    let cancel = false;
    const fetchData = async () => {
      try {
        const [resCajas, resTurnos, resDenoms] = await Promise.all([
          client.get(`/api/ventas/cajas`),
          client.get(`/api/ventas/turnos`),
          client.get(`/api/ventas/denominaciones`),
        ]);
        if (cancel) return;

        setCajas(Array.isArray(resCajas.data) ? resCajas.data : []);
        setTurnos(Array.isArray(resTurnos.data) ? resTurnos.data : []);
        const dens = Array.isArray(resDenoms.data) ? resDenoms.data : [];
        setDenominaciones(dens.map((d) => ({ ...d, cantidad: 0 })));
      } catch (error) {
        console.error("❌ Error cargando datos:", error);
        toast.error("Error cargando datos de apertura");
      }
    };
    fetchData();
    return () => {
      cancel = true;
    };
  }, []);

  // Manejar cantidad
  const handleCantidadChange = (index, value) => {
    const nuevas = [...denominaciones];
    const cantidad = Number.isFinite(+value) ? Math.max(0, parseInt(value)) : 0;
    nuevas[index].cantidad = cantidad;
    setDenominaciones(nuevas);
  };

  // Total efectivo (a prueba de NaN)
  const totalEfectivo = denominaciones.reduce((acc, d) => {
    const val = Number(d.VALOR ?? d.valor ?? 0);
    const cant = Number(d.cantidad ?? 0);
    return acc + (isNaN(val) || isNaN(cant) ? 0 : val * cant);
  }, 0);

  // Usuario logueado
  const getUsuarioId = () => {
    try {
      const userData =
        JSON.parse(localStorage.getItem("userData")) ||
        JSON.parse(sessionStorage.getItem("userData"));
      return userData?.id || localStorage.getItem("usuario_id") || null;
    } catch {
      return null;
    }
  };

  // Validaciones
  const validarFormulario = () => {
    const nuevosErrores = { caja: false, turno: false, observaciones: false };

    if (!caja) {
      nuevosErrores.caja = true;
      setErrors(nuevosErrores);
      return false;
    }
    if (!turno) {
      nuevosErrores.turno = true;
      setErrors(nuevosErrores);
      return false;
    }

    const totalCantidad = denominaciones.reduce(
      (acc, d) => acc + (d.cantidad || 0),
      0
    );
    if (totalCantidad === 0) {
      toast.error("Debe ingresar al menos una denominación");
      setErrors(nuevosErrores);
      return false;
    }

    const faltantes = denominaciones.filter((d) => (d.cantidad || 0) === 0)
      .length;
    if (faltantes > 0 && !observaciones.trim()) {
      nuevosErrores.observaciones = true;
      setErrors(nuevosErrores);
      return false;
    }

    setErrors(nuevosErrores);
    return true;
  };

  // Confirmar apertura (abre modal admin)
  const handleApertura = async () => {
    if (!validarFormulario()) return;

    const usuarioId = getUsuarioId();
    if (!usuarioId) {
      toast.error("No se pudo obtener el usuario logueado");
      return;
    }

    confirmarAccion({
      title: "¿Está seguro que desea aperturar la caja?",
      text: "Se registrará la apertura con las denominaciones ingresadas",
      confirmButtonText: "Sí, aperturar",
      onConfirm: async () => {
        const payload = {
          usuario_id: Number(usuarioId),
          caja_id: Number(caja),
          turno_id: Number(turno),
          estado_id: 1,
          observaciones: observaciones.trim() || null,
          denominaciones: denominaciones.map((d) => ({
            denominacion_id:
              d.ID_DENOMINACION ?? d.id_denominacion ?? d.id ?? null,
            cantidad: Number(d.cantidad || 0),
          })),
        };
        setPayloadAperturaPendiente(payload);
        setShowAdminModal(true);
      },
    });
  };

  // Admin OK → enviar apertura
  const onAdminConfirmado = async (adminInfo) => {
    setShowAdminModal(false);
    if (!payloadAperturaPendiente) return;

    setLoading(true);
    try {
      const res = await client.post(`/api/ventas/apertura`, {
        ...payloadAperturaPendiente,
        admin_id: adminInfo?.id || null,
      });

      const ticketMsg = res.data?.numero_ticket
        ? ` (Ticket ${res.data.numero_ticket})`
        : "";
      toast.success(
        res.data?.message || `✅ Caja aperturada con éxito${ticketMsg}`
      );

      // Abrir PDF
      if (res.data?.apertura_id) {
        window.open(
          `${API_BASE}/api/pdf/apertura-caja/${res.data.apertura_id}`,
          "_blank"
        );
      }

      // Reset
      setCaja("");
      setTurno("");
      setObservaciones("");
      setDenominaciones((prev) => prev.map((d) => ({ ...d, cantidad: 0 })));
      setErrors({ caja: false, turno: false, observaciones: false });
      setPayloadAperturaPendiente(null);
    } catch (error) {
      console.error("❌ Error al aperturar caja:", error);
      const msg =
        error.response?.data?.message || "❌ No se pudo aperturar la caja";
      toast.error(msg);
    } finally {
      setLoading(false);
    }
  };

  return (
    <div className="apertura-container">
      {/* Aviso */}
      <div className="alert">
        <strong>Apertura de Caja:</strong> Complete todos los campos requeridos
        para iniciar las operaciones del día.
      </div>

      <div className="content">
        {/* Columna izquierda */}
        <div className="card info-general">
          <div className="card-header">Información General</div>
          <div className="card-body">
            <div className="form-group">
              <label>Número de Caja *</label>
              <select
                className={`form-select ${errors.caja ? "is-invalid" : ""}`}
                value={caja}
                onChange={(e) => setCaja(e.target.value)}
              >
                <option value="">Seleccionar caja...</option>
                {cajas.map((c) => (
                  <option key={c.ID ?? c.id} value={c.ID ?? c.id}>
                    {c.NOMBRE ?? c.nombre}
                  </option>
                ))}
              </select>
              {errors.caja && (
                <div className="invalid-feedback">Campo obligatorio</div>
              )}
            </div>

            <div className="form-group">
              <label>Turno *</label>
              <select
                className={`form-select ${errors.turno ? "is-invalid" : ""}`}
                value={turno}
                onChange={(e) => setTurno(e.target.value)}
              >
                <option value="">Seleccionar turno...</option>
                {turnos.map((t) => (
                  <option key={t.ID ?? t.id} value={t.ID ?? t.id}>
                    {t.NOMBRE ?? t.nombre}
                  </option>
                ))}
              </select>
              {errors.turno && (
                <div className="invalid-feedback">Campo obligatorio</div>
              )}
            </div>

            <div className="form-group">
              <label>Observaciones</label>
              <textarea
                className={`form-control ${
                  errors.observaciones ? "is-invalid" : ""
                }`}
                rows="2"
                value={observaciones}
                onChange={(e) => setObservaciones(e.target.value)}
                placeholder="Ingrese motivo si falta alguna denominación..."
              />
              {errors.observaciones && (
                <div className="invalid-feedback">
                  Debe ingresar observaciones si falta alguna denominación
                </div>
              )}
            </div>

            <button
              className="btn-apertura"
              onClick={handleApertura}
              disabled={loading}
            >
              {loading ? "Procesando..." : "🚀 Aperturar Caja"}
            </button>
          </div>
        </div>

        {/* Columna derecha */}
        <div className="card conteo">
          <div className="card-header">Conteo de Efectivo Inicial</div>
          <div className="card-body">
            <table className="table table-bordered text-center">
              <thead className="table-dark">
                <tr>
                  <th>Denominación</th>
                  <th>Cantidad</th>
                  <th>Subtotal</th>
                </tr>
              </thead>
              <tbody>
                {denominaciones.map((d, i) => {
                  const val = Number(d.VALOR ?? d.valor ?? 0);
                  const cant = Number(d.cantidad ?? 0);
                  const key =
                    d.ID_DENOMINACION ?? d.id_denominacion ?? d.id ?? i;
                  return (
                    <tr key={key}>
                      <td>{labelDenom(val)}</td>
                      <td>
                        <input
                          type="number"
                          min="0"
                          className="form-control text-center"
                          value={cant}
                          onChange={(e) => handleCantidadChange(i, e.target.value)}
                        />
                      </td>
                      <td>Q{(val * cant).toFixed(2)}</td>
                    </tr>
                  );
                })}
              </tbody>
            </table>

            <div className="total-box">
              Total Efectivo Inicial: Q{totalEfectivo.toFixed(2)}
            </div>
          </div>
        </div>
      </div>

      {/* 🔒 Modal de verificación de Administrador */}
      <VerificarAdmin
        open={showAdminModal}
        onClose={() => setShowAdminModal(false)}
        onSuccess={onAdminConfirmado}
      />
    </div>
  );
};

export default AperturaCaja;
