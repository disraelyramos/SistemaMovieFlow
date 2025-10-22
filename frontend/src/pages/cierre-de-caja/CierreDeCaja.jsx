// src/pages/cierre-de-caja/CierreDeCaja.jsx
import React, { useState, useEffect } from "react";
import axios from "axios";
import { toast } from "react-toastify";
import { confirmarAccion } from "../../utils/confirmations";
import "../../styles/cierre-de-caja/CierredeCaja.css";
import VerificarAdmin from "../../components/verificacion/VerificarAdmin";


const API_BASE = import.meta.env.VITE_API_BASE_URL || "http://localhost:3001";
const API_CIERRE = `${API_BASE}/api/cierre-de-caja`; // ⬅️ prefijo único y canónico

const CierredeCaja = () => {
  const [denominaciones, setDenominaciones] = useState([]);
  const [cantidades, setCantidades] = useState({});
  const [observaciones, setObservaciones] = useState("");
  const [cajaAbierta, setCajaAbierta] = useState(null); // ✅ objeto { id_apertura, nombre_caja, ... }
  const [infoCierre, setInfoCierre] = useState({
    fecha_cierre: "",
    hora_cierre: "",
    rol_usuario: "",
    nombre_caja: "",
    monto_apertura: 0,
    total_ventas: 0,
    pagos_reservas: 0,
    monto_esperado: 0,
    id_apertura: null,
  });
  const [errorCaja, setErrorCaja] = useState("");
  const [loading, setLoading] = useState(true);
  const [closing, setClosing] = useState(false); // ⬅️ evita doble click/envío

  // 🔹 Modal y payload pendiente
  const [showAdminModal, setShowAdminModal] = useState(false);
  const [payloadCierrePendiente, setPayloadCierrePendiente] = useState(null);

  // ========= Helpers para verificar admin por BD (sin JWT) =========
  const candidates = [
    "/api/auth/verify-admin",
    "/api/empleados/verify-admin",
    "/api/admin/verify",
  ];

  const normalizeAdmin = (raw) => {
    if (!raw) return null;
    const a = raw.admin || raw.user || raw.usuario || raw;
    return {
      id: a?.id || a?.ID || a?.id_usuario || a?.ID_USUARIO || null,
      usuario: a?.usuario || a?.USERNAME || a?.name || a?.NAME || "",
      rol: a?.rol || a?.role || a?.ROL || a?.ROLE || "",
      role_id: a?.role_id || a?.ROL_ID || a?.id_rol || null,
      ...a,
    };
  };

  const tryVerifyAdminById = async (userId) => {
    try {
      if (!userId) return null;
      const payload = { user_id: userId };
      for (const path of candidates) {
        try {
          const { data } = await axios.post(`${API_BASE}${path}`, payload, {
            headers: { "Content-Type": "application/json" },
          });
          const ok =
            data?.ok === true ||
            data?.success === true ||
            !!data?.admin ||
            !!data?.user ||
            !!data?.usuario;
          if (ok) return normalizeAdmin(data);
        } catch {
          // probar con el siguiente endpoint candidato
        }
      }
      return null;
    } catch {
      return null;
    }
  };

  // === Helper de formato: Q200/Q1/Q0.50/Q0.25 ===
  const labelDenom = (v) => {
    const n = Number(v || 0);
    return n >= 1 ? `Q${Math.round(n)}` : `Q${n.toFixed(2)}`;
  };

  // ========= Cargar denominaciones y caja abierta =========
  useEffect(() => {
    const fetchData = async () => {
      try {
        const userData =
          JSON.parse(localStorage.getItem("userData")) ||
          JSON.parse(sessionStorage.getItem("userData"));

        if (!userData?.id) return;

        // Denominaciones
        try {
          const resDenoms = await axios.get(`${API_BASE}/api/ventas/denominaciones`);
          const inicial = {};
          (resDenoms.data || []).forEach((d) => {
            const id = d.ID_DENOMINACION || d.id_denominacion || d.id;
            inicial[id] = 0;
          });
          setCantidades(inicial);
          setDenominaciones(resDenoms.data || []);
        } catch (err) {
          console.error("❌ Error al cargar denominaciones:", err);
          toast.error("❌ Error al cargar denominaciones");
        }

        // Caja abierta (apertura activa del usuario)
        try {
          const resCaja = await axios.get(`${API_CIERRE}/apertura-activa`, {
            params: { usuario_id: userData.id },
          });
          setCajaAbierta(resCaja.data || null);

          // ⬇️ Autoseleccionar si viene una apertura activa
          if (resCaja?.data?.id_apertura) {
            await handleCajaSelect(resCaja.data.id_apertura);
          }
        } catch (err) {
          console.error("❌ Error al cargar caja abierta:", err);
        }
      } finally {
        setLoading(false);
      }
    };

    fetchData();
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  // ========= obtener total de "Pagos de Reservas" (ruta canónica) =========
  const fetchPagosReservas = async (aperturaId) => {
    if (!aperturaId) return 0;
    try {
      const { data } = await axios.get(`${API_CIERRE}/pagos-reservas-total`, {
        params: { apertura_id: aperturaId },
      });
      return (
        Number(
          data?.total ||
            data?.total_pagos ||
            data?.pagos_reservas ||
            data?.total_pagos_reservas
        ) || 0
      );
    } catch {
      return 0; // sin ruidos en consola
    }
  };

  // ========= UI / Cálculos =========
  const handleCajaSelect = async (id_apertura) => {
    if (!id_apertura) {
      setInfoCierre({
        fecha_cierre: "",
        hora_cierre: "",
        rol_usuario: "",
        nombre_caja: "",
        monto_apertura: 0,
        total_ventas: 0,
        pagos_reservas: 0,
        monto_esperado: 0,
        id_apertura: null,
      });
      return;
    }

    try {
      const userData =
        JSON.parse(localStorage.getItem("userData")) ||
        JSON.parse(sessionStorage.getItem("userData"));

      // Info consolidada de la apertura
      const res = await axios.get(`${API_CIERRE}/info`, {
        params: { usuario_id: userData.id, id_apertura },
      });

      if (res.data?.abierta) {
        // Si el backend no manda pagos_reservas, lo consultamos por el endpoint canónico
        let totalPagos = Number(
          res.data.pagos_reservas ||
            res.data.total_pagos_reservas ||
            res.data.total_pagos ||
            0
        );
        if (!totalPagos) {
          totalPagos = await fetchPagosReservas(res.data.id_apertura);
        }

        setInfoCierre({
          fecha_cierre: res.data.fecha_cierre,
          hora_cierre: res.data.hora_cierre,
          rol_usuario: res.data.rol_usuario,
          nombre_caja: res.data.nombre_caja,
          monto_apertura: Number(res.data.monto_apertura || 0),
          total_ventas: Number(res.data.total_ventas || 0),
          pagos_reservas: Number(totalPagos || 0),
          monto_esperado: Number(res.data.monto_esperado || 0),
          id_apertura: res.data.id_apertura,
        });
        setErrorCaja("");
      }
    } catch (error) {
      console.error("❌ Error al cargar info de caja:", error);
      toast.error("❌ No se pudo cargar la información de la caja");
    }
  };

  const handleCantidadChange = (id, value) => {
    setCantidades((prev) => ({
      ...prev,
      [id]: parseInt(value) >= 0 ? parseInt(value) : 0,
    }));
  };

  const calcularSubtotal = (id, valor) => {
    const cantidad = Number(cantidades[id] || 0);
    const v = Number(valor || 0);
    return cantidad * v;
  };

  const totalContado = (denominaciones || []).reduce((acc, d) => {
    const id = d.ID_DENOMINACION || d.id_denominacion;
    const v = Number(d.VALOR || d.valor || 0);
    return acc + calcularSubtotal(id, v);
  }, 0);

  // ========= Cerrar caja =========
  const handleCerrarCaja = async () => {
    if (closing) return; // ⬅️ si ya está procesando, ignora nuevos clics

    const userData =
      JSON.parse(localStorage.getItem("userData")) ||
      JSON.parse(sessionStorage.getItem("userData"));

    if (!infoCierre.id_apertura) {
      setErrorCaja("Debe seleccionar una caja antes de continuar");
      return;
    }
    setErrorCaja("");

    const denominacionesArray = Object.entries(cantidades).map(
      ([id, cantidad]) => ({
        denominacion_id: parseInt(id),
        cantidad,
      })
    );

    const totalCantidad = denominacionesArray.reduce(
      (acc, d) => acc + d.cantidad,
      0
    );
    if (totalCantidad === 0) {
      toast.error("❌ Debe ingresar denominaciones");
      return;
    }

    if (totalContado < infoCierre.monto_esperado) {
      toast.error(
        `❌ No cuadra el cierre. Faltan Q${(
          infoCierre.monto_esperado - totalContado
        ).toFixed(2)}`
      );
      return;
    }

    if (totalContado > infoCierre.monto_esperado && !observaciones.trim()) {
      toast.error("❌ Debe ingresar observaciones cuando sobra dinero en caja");
      return;
    }

    confirmarAccion({
      title: "¿Desea cerrar la caja?",
      text: `Se cerrará la caja con Q${totalContado.toFixed(2)}.`,
      confirmButtonText: "Sí, cerrar",
      onConfirm: async () => {
        // Guardar payload
        setPayloadCierrePendiente({
          usuario_id: userData.id,
          apertura_id: infoCierre.id_apertura,
          observaciones: observaciones || null,
          denominaciones: denominacionesArray,
          pagos_reservas: Number(infoCierre.pagos_reservas || 0), // opcional
        });

        // FAST-PATH: consultar si el usuario ya es admin activo
        const adminInfo = await tryVerifyAdminById(userData.id);
        if (adminInfo?.id) {
          await onAdminConfirmado(adminInfo);
        } else {
          setShowAdminModal(true);
        }
      },
    });
  };

  // Cuando el admin se verifica (fast-path o modal), enviar el cierre
  const onAdminConfirmado = async (adminInfo) => {
    setShowAdminModal(false);
    if (!payloadCierrePendiente) return;

    try {
      setClosing(true); // ⬅️ evita doble envío real
      const res = await axios.post(`${API_CIERRE}`, {
        ...payloadCierrePendiente,
        admin_id: adminInfo?.id || null, // quién autorizó
      });

      const ticket = res.data?.numero_ticket;
      if (ticket) {
        toast.success(`Ticket ${ticket}`);
      } else if (res.data?.message) {
        toast.success(res.data.message || "✅ Caja cerrada correctamente");
      }

      // Abrir PDF de CORTE automáticamente
      if (res.data.cierre_id) {
        window.open(
          `${API_BASE}/api/pdf/corte-caja/${res.data.cierre_id}`,
          "_blank"
        );
      }

      // Reset UI
      setObservaciones("");
      const resetCant = {};
      denominaciones.forEach((d) => {
        const id = d.ID_DENOMINACION || d.id_denominacion;
        resetCant[id] = 0;
      });
      setCantidades(resetCant);

      setInfoCierre({
        fecha_cierre: "",
        hora_cierre: "",
        rol_usuario: "",
        nombre_caja: "",
        monto_apertura: 0,
        total_ventas: 0,
        pagos_reservas: 0,
        monto_esperado: 0,
        id_apertura: null,
      });

      setCajaAbierta(null);
      setPayloadCierrePendiente(null);
    } catch (error) {
      console.error("❌ Error al cerrar caja:", error);
      const msg =
        error.response?.data?.message || "❌ No se pudo cerrar la caja";
      toast.error(msg);
    } finally {
      setClosing(false);
    }
  };

  return (
    <div className="cierre-container">
      {loading ? (
        <div className="loading">Cargando información...</div>
      ) : (
        <>
          {/* 🔹 Datos */}
          <div className="info-row">
            <div className="info-card">
              <label>FECHA DE CIERRE</label>
              <input type="text" value={infoCierre.fecha_cierre} disabled />
            </div>
            <div className="info-card">
              <label>HORA DE CIERRE</label>
              <input type="text" value={infoCierre.hora_cierre} disabled />
            </div>
            <div className="info-card">
              <label>ROL DEL USUARIO</label>
              <input type="text" value={infoCierre.rol_usuario} disabled />
            </div>
            <div className="info-card">
              <label>NÚMERO DE CAJA</label>
              <select
                value={infoCierre.id_apertura || ""}
                onChange={(e) => handleCajaSelect(e.target.value)}
              >
                <option value="">-- Seleccione Caja --</option>
                {cajaAbierta && (
                  <option value={cajaAbierta.id_apertura}>
                    {cajaAbierta.nombre_caja}
                  </option>
                )}
              </select>
              {errorCaja && <p className="error-text">{errorCaja}</p>}
            </div>
          </div>

          {/* 🔹 Totales */}
          <div className="totales-row">
            <div className="total-card apertura">
              <p>Monto de Apertura</p>
              <h3>Q{Number(infoCierre.monto_apertura || 0).toFixed(2)}</h3>
            </div>
            <div className="total-card ventas">
              <p>Total en Ventas</p>
              <h3>Q{Number(infoCierre.total_ventas || 0).toFixed(2)}</h3>
            </div>

            {/* 🔹 Pagos de Reservas */}
            <div className="total-card reservas">
              <p>Pagos de Reservas</p>
              <h3>Q{Number(infoCierre.pagos_reservas || 0).toFixed(2)}</h3>
            </div>

            <div className="total-card debe-haber">
              <p>Dinero que Debe Haber</p>
              <h3>Q{Number(infoCierre.monto_esperado || 0).toFixed(2)}</h3>
            </div>
          </div>

          {/* 🔹 Observaciones */}
          <div className="form-group observaciones">
            <label>Observaciones</label>
            <textarea
              rows="2"
              className="form-control"
              placeholder="Ingrese observaciones (opcional)"
              value={observaciones}
              onChange={(e) => setObservaciones(e.target.value)}
            />
          </div>

          {/* 🔹 Tabla denominaciones */}
          <div className="tabla-container">
            <table>
              <thead>
                <tr>
                  <th>Denominación</th>
                  <th>Cantidad</th>
                  <th>Subtotal</th>
                </tr>
              </thead>
              <tbody>
                {denominaciones.map((d) => {
                  const id = d.ID_DENOMINACION || d.id_denominacion;
                  const valor = Number(d.VALOR ?? d.valor ?? 0);
                  return (
                    <tr key={id}>
                      <td>{labelDenom(valor)}</td>
                      <td>
                        <input
                          type="number"
                          min="0"
                          value={cantidades[id] || 0}
                          onChange={(e) =>
                            handleCantidadChange(id, e.target.value)
                          }
                        />
                      </td>
                      <td>Q{calcularSubtotal(id, valor).toFixed(2)}</td>
                    </tr>
                  );
                })}
              </tbody>
            </table>

            {/* 🔹 Total contado */}
            <div className="total-contado">
              <span>Total Contado:</span>
              <strong>Q{totalContado.toFixed(2)}</strong>
            </div>
          </div>

          {/* 🔹 Botón cerrar */}
          <div className="boton-cierre">
            <button onClick={handleCerrarCaja} disabled={closing}>
              {closing ? "Cerrando..." : "Cerrar Caja"}
            </button>
          </div>

          {/* 🔒 Modal de verificación de Administrador (silenciado) */}
          <VerificarAdmin
            open={showAdminModal}
            onClose={() => setShowAdminModal(false)}
            onSuccess={onAdminConfirmado}
            quiet
          />
        </>
      )}
    </div>
  );
};

export default CierredeCaja;
