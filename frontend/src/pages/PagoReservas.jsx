// src/pages/PagoReservas.jsx
import React, { useEffect, useMemo, useState } from "react";
import { toast } from "react-toastify";

const API_BASE =
  import.meta?.env?.VITE_API_BASE ||
  import.meta?.env?.VITE_API_BASE_URL ||
  import.meta?.env?.VITE_API_URL ||
  "http://localhost:3001";

/* ===== Helpers de auth/usuario ===== */
const getUsuarioId = () => {
  try {
    const userData =
      JSON.parse(localStorage.getItem("userData")) ||
      JSON.parse(sessionStorage.getItem("userData"));
    return (
      userData?.id ||
      localStorage.getItem("mf_user_id") ||
      localStorage.getItem("user_id") ||
      null
    );
  } catch {
    return null;
  }
};

const authHeaders = () => {
  const t = localStorage.getItem("mf_token");
  const uid = getUsuarioId();
  const headers = t ? { Authorization: `Bearer ${t}` } : {};
  if (uid) headers["x-user-id"] = uid; // <- backend lo lee de aquí
  return headers;
};

const fmt = (d) => {
  try {
    const dt = new Date(d);
    const fecha = dt.toLocaleDateString("es-GT", {
      year: "numeric",
      month: "2-digit",
      day: "2-digit",
    });
    const hora = dt.toLocaleTimeString("es-GT", {
      hour: "2-digit",
      minute: "2-digit",
    });
    return `${fecha} ${hora}`;
  } catch {
    return String(d);
  }
};

const fmtQ = (n) => `Q ${Number(n || 0).toFixed(2)}`;

/* ===== Regla de tarifas (frente) ===== */
const calcTarifaPorDuracion = (durMin) => {
  const d = Number(durMin);
  if (!Number.isFinite(d)) return null;
  if (d <= 150) return 3500;
  if (d >= 180) return 4500;
  // 151–179: misma política que backend (Q3,500)
  return 3500;
};

async function getJson(url, options = {}) {
  const res = await fetch(url, {
    method: "GET",
    headers: { Accept: "application/json", ...(options.headers || {}) },
    ...options,
  });
  if (!res.ok) throw new Error(await res.text());
  return res.json();
}
async function postJson(url, body = {}, options = {}) {
  const res = await fetch(url, {
    method: "POST",
    headers: { "Content-Type": "application/json", ...(options.headers || {}) },
    body: JSON.stringify(body),
  });
  const data = await res.json().catch(() => ({}));
  if (!res.ok || data?.ok === false) {
    throw new Error(data?.error || data?.detail || `Error HTTP ${res.status}`);
  }
  return data;
}

export default function PagoReservas() {
  const [desde, setDesde] = useState("");
  const [hasta, setHasta] = useState("");
  const [items, setItems] = useState([]);
  const [loading, setLoading] = useState(false);

  const [openPay, setOpenPay] = useState(false);
  const [sel, setSel] = useState(null);
  const [monto, setMonto] = useState("");
  const [obs, setObs] = useState("");

  const headers = useMemo(() => authHeaders(), []);

  const fetchData = async () => {
    setLoading(true);
    try {
      const params = new URLSearchParams();
      if (desde) params.set("desde", desde);
      if (hasta) params.set("hasta", hasta);
      const url = `${API_BASE}/api/pagos-reservas/por-cobrar${
        params.toString() ? "?" + params.toString() : ""
      }`;
      const data = await getJson(url, { headers });
      setItems(data?.data || []);
    } catch (err) {
      console.error(err);
      toast.error("Error al cargar reservas por cobrar");
    } finally {
      setLoading(false);
    }
  };

  useEffect(() => {
    fetchData();
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  /* ===== Validación y envío ===== */
  const onPagar = async () => {
    try {
      const eventoId = Number(sel?.ID_EVENTO);
      const m = Number(monto);
      const usuarioId = Number(getUsuarioId());

      if (!eventoId) return toast.warn("Evento no seleccionado");
      if (!m || m <= 0) return toast.warn("Ingrese un monto válido");
      if (!usuarioId) return toast.error("No se pudo obtener el usuario logueado");

      // **Validación de tarifa según duración (front)**
      const dur = Number(sel?.DURACION_MIN ?? sel?.DURACIONMIN);
      const tarifa = calcTarifaPorDuracion(dur);
      if (tarifa == null) {
        return toast.error("No fue posible determinar la tarifa del evento.");
      }
      if (Number(m.toFixed(2)) !== Number(tarifa.toFixed(2))) {
        return toast.error(
          `El monto debe ser ${fmtQ(tarifa)} para ${dur} minutos.`
        );
      }

      const body = {
        eventoId,
        monto: m, // el backend volverá a imponer la tarifa correcta
        usuarioId,
        obs: (obs || "").trim() || null,
      };

      // enviar también x-user-id en headers (además del Authorization que ya arma authHeaders)
      const mergedHeaders = { ...headers, "x-user-id": String(usuarioId) };

      await postJson(`${API_BASE}/api/pagos-reservas`, body, {
        headers: mergedHeaders,
      });
      toast.success("Pago registrado");
      setOpenPay(false);
      setMonto("");
      setObs("");
      setSel(null);
      // refrescar lista
      fetchData();
    } catch (err) {
      console.error(err);
      toast.error(String(err.message || err));
    }
  };

  /* ===== Abrir modal con monto precargado ===== */
  const openPayModal = (row) => {
    setSel(row);
    const dur = Number(row?.DURACION_MIN ?? row?.DURACIONMIN);
    const tarifa = calcTarifaPorDuracion(dur);
    setMonto(tarifa != null ? String(tarifa.toFixed(2)) : "");
    setOpenPay(true);
  };

  /* ===== UI ===== */
  return (
    <div className="pr-container" style={{ padding: 20 }}>
      <div
        className="pr-card"
        style={{
          background: "#111827",
          color: "#fff",
          borderRadius: 16,
          boxShadow: "0 6px 22px rgba(0,0,0,0.3)",
          padding: 16,
        }}
      >
        <div
          className="pr-header"
          style={{
            display: "flex",
            alignItems: "center",
            justifyContent: "space-between",
            gap: 12,
            flexWrap: "wrap",
          }}
        >
          <h2 style={{ margin: 0, fontSize: 20 }}>Pago de Reservas (Caja)</h2>
          <div
            style={{ display: "flex", gap: 8, alignItems: "center", flexWrap: "wrap" }}
          >
            <label style={{ fontSize: 13, opacity: 0.85 }}>Desde</label>
            <input
              type="date"
              value={desde}
              onChange={(e) => setDesde(e.target.value)}
              style={{
                background: "#1f2937",
                color: "#fff",
                border: "1px solid #374151",
                borderRadius: 8,
                padding: "6px 8px",
              }}
            />
            <label style={{ fontSize: 13, opacity: 0.85 }}>Hasta</label>
            <input
              type="date"
              value={hasta}
              onChange={(e) => setHasta(e.target.value)}
              style={{
                background: "#1f2937",
                color: "#fff",
                border: "1px solid #374151",
                borderRadius: 8,
                padding: "6px 8px",
              }}
            />
            <button
              onClick={fetchData}
              disabled={loading}
              style={{
                padding: "8px 12px",
                borderRadius: 10,
                border: "none",
                background: "#F59E0B",
                color: "#111",
                fontWeight: 600,
              }}
            >
              {loading ? "Cargando..." : "Buscar"}
            </button>
          </div>
        </div>

        {/* Nota de tarifas (visible para el empleado) */}
        <div
          style={{
            marginTop: 10,
            background: "#0b1220",
            border: "1px solid #2b3445",
            borderRadius: 10,
            padding: "10px 12px",
            color: "#E5E7EB",
            fontSize: 13,
          }}
        >
          <b>Tarifas de reservas:</b>{" "}
          ≤ 150 minutos: <b>{fmtQ(3500)}</b> — ≥ 180 minutos:{" "}
          <b>{fmtQ(4500)}</b>. (Entre 151 y 179 minutos aplica{" "}
          <b>{fmtQ(3500)}</b>).
        </div>

        <div style={{ marginTop: 12, overflow: "auto" }}>
          <table style={{ width: "100%", borderCollapse: "collapse" }}>
            <thead>
              <tr style={{ background: "#0b1220" }}>
                <th style={th}>Evento</th>
                <th style={th}>Sala</th>
                <th style={th}>Inicio</th>
                <th style={th}>Fin</th>
                <th style={th}>Personas</th>
                <th style={th}>Notas</th>
                <th style={thCenter}>Acción</th>
              </tr>
            </thead>
            <tbody>
              {items.length === 0 && (
                <tr>
                  <td
                    colSpan={7}
                    style={{ padding: 16, textAlign: "center", color: "#9CA3AF" }}
                  >
                    {loading
                      ? "Cargando..."
                      : "Sin reservas confirmadas por cobrar en el rango seleccionado"}
                  </td>
                </tr>
              )}
              {items.map((r) => (
                <tr key={r.ID_EVENTO} style={{ borderTop: "1px solid #1f2937" }}>
                  <td style={td}>{r.ID_EVENTO}</td>
                  <td style={td}>{r.SALA_NOMBRE || r.SALA_ID}</td>
                  <td style={td}>{fmt(r.START_TS)}</td>
                  <td style={td}>{fmt(r.END_TS)}</td>
                  <td style={td}>{r.PERSONAS}</td>
                  <td style={td}>
                    {String(r.NOTAS || "").replace(/\[UEMAIL:[^\]]+\]/g, "").trim()}
                  </td>
                  <td style={{ ...td, textAlign: "center" }}>
                    <button
                      onClick={() => openPayModal(r)}
                      style={{
                        padding: "6px 10px",
                        borderRadius: 10,
                        border: "none",
                        background: "#10B981",
                        color: "#111",
                        fontWeight: 700,
                      }}
                    >
                      Registrar pago
                    </button>
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>

        {/* Modal de pago */}
        {openPay && (
          <div className="pr-modal" style={modalWrap}>
            <div style={modalCard}>
              <h3 style={{ marginTop: 0, marginBottom: 8 }}>Pago en efectivo</h3>
              <p style={{ margin: "6px 0 12px 0", color: "#D1D5DB" }}>
                Evento <b>#{sel?.ID_EVENTO}</b> — Sala{" "}
                <b>{sel?.SALA_NOMBRE || sel?.SALA_ID}</b>
                <br />
                Inicio: {fmt(sel?.START_TS)}
              </p>

              {/* Info: duración y tarifa calculada */}
              <div
                style={{
                  background: "#0b1220",
                  border: "1px solid #2b3445",
                  borderRadius: 10,
                  padding: "10px 12px",
                  color: "#E5E7EB",
                  fontSize: 13,
                  marginBottom: 10,
                }}
              >
                Duración:{" "}
                <b>{Number(sel?.DURACION_MIN ?? sel?.DURACIONMIN) || 0} min</b> — Tarifa:{" "}
                <b>
                  {fmtQ(
                    calcTarifaPorDuracion(
                      Number(sel?.DURACION_MIN ?? sel?.DURACIONMIN)
                    ) || 0
                  )}
                </b>
              </div>

              <div style={{ display: "grid", gap: 10 }}>
                <label style={{ fontSize: 13, color: "#E5E7EB" }}>
                  Monto (GTQ)
                  <input
                    type="number"
                    min="0"
                    step="0.01"
                    value={monto}
                    onChange={(e) => setMonto(e.target.value)}
                    placeholder="0.00"
                    style={inp}
                  />
                </label>
                <label style={{ fontSize: 13, color: "#E5E7EB" }}>
                  Observaciones
                  <textarea
                    value={obs}
                    onChange={(e) => setObs(e.target.value)}
                    placeholder="Opcional"
                    rows={3}
                    style={{ ...inp, resize: "vertical" }}
                  />
                </label>
              </div>
              <div
                style={{
                  display: "flex",
                  justifyContent: "flex-end",
                  gap: 8,
                  marginTop: 14,
                }}
              >
                <button
                  onClick={() => {
                    setOpenPay(false);
                    setSel(null);
                  }}
                  style={btnGhost}
                >
                  Cancelar
                </button>
                <button onClick={onPagar} style={btnPrimary}>
                  Registrar pago {monto ? `(${fmtQ(monto)})` : ""}
                </button>
              </div>
            </div>
          </div>
        )}
      </div>
    </div>
  );
}

const th = {
  textAlign: "left",
  padding: "10px 12px",
  fontSize: 13,
  fontWeight: 700,
  color: "#CBD5E1",
};
const thCenter = { ...th, textAlign: "center" };
const td = { padding: "10px 12px", fontSize: 13, color: "#E5E7EB" };
const inp = {
  width: "100%",
  marginTop: 6,
  background: "#0b1220",
  color: "#fff",
  border: "1px solid #2b3445",
  borderRadius: 10,
  padding: "10px 12px",
  outline: "none",
};
const modalWrap = {
  position: "fixed",
  inset: 0,
  background: "rgba(0,0,0,.55)",
  display: "flex",
  alignItems: "center",
  justifyContent: "center",
  padding: 16,
  zIndex: 1000,
};
const modalCard = {
  width: "100%",
  maxWidth: 520,
  background: "#111827",
  color: "#fff",
  borderRadius: 14,
  boxShadow: "0 10px 30px rgba(0,0,0,.35)",
  padding: 16,
  border: "1px solid #1f2937",
};
const btnGhost = {
  padding: "10px 14px",
  borderRadius: 10,
  background: "transparent",
  border: "1px solid #374151",
  color: "#E5E7EB",
  fontWeight: 600,
};
const btnPrimary = {
  padding: "10px 14px",
  borderRadius: 10,
  border: "none",
  background: "#F59E0B",
  color: "#111827",
  fontWeight: 800,
};
