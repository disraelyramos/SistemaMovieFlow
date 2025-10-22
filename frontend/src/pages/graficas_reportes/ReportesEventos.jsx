// src/pages/ReportesEventos.jsx
import React, { useEffect, useMemo, useState, useRef } from "react";
import axios from "axios";
import { Bar, Line } from "react-chartjs-2";

// 🔧 Chart.js v3/v4: registrar escalas y elementos (reemplaza sintaxis v2)
import {
  Chart as ChartJS,
  CategoryScale,
  LinearScale,
  PointElement,
  LineElement,
  BarElement,
  Title,
  Tooltip,
  Legend,
} from "chart.js";
ChartJS.register(
  CategoryScale,
  LinearScale,
  PointElement,
  LineElement,
  BarElement,
  Title,
  Tooltip,
  Legend
);

import "../../styles/graficas_reportes/reportes-eventos.css";

/* ===== API BASE ===== */
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

function toDate(s) {
  if (!s) return null;
  try { return new Date(s); } catch { return null; }
}

function weekKey(d) {
  const dd = new Date(Date.UTC(d.getFullYear(), d.getMonth(), d.getDate()));
  const dayNum = dd.getUTCDay() || 7;
  dd.setUTCDate(dd.getUTCDate() + 4 - dayNum);
  const yearStart = new Date(Date.UTC(dd.getUTCFullYear(), 0, 1));
  const weekNo = Math.ceil((((dd - yearStart) / 86400000) + 1) / 7);
  return `${dd.getUTCFullYear()}-W${String(weekNo).padStart(2, "0")}`;
}

/* ======================= Normalización de SALA ======================= */
function normalizeSalaName(x) {
  if (!x) return "";
  let s = String(x).trim().toUpperCase().replace(/\s+/g, " ");
  if (s === "SALA 9") s = "SALA A";
  return s;
}
function getSalaId(r) {
  const raw =
    r.SALA_ID ?? r.sala_id ??
    r.ID_SALA ?? r.id_sala ??
    r.SALAID ?? r.salaId ?? null;
  const n = Number(raw);
  return Number.isNaN(n) ? null : n;
}
function getSalaNombre(r) {
  const direct =
    r.SALA_NOMBRE ?? r.sala_nombre ??
    r.NOMBRE_SALA ?? r.nombre_sala ??
    r.SALA ?? r.sala ?? null;
  return normalizeSalaName(direct);
}
function getEstado(r) {
  return String(r.ESTADO ?? r.estado ?? r.status ?? "").toUpperCase();
}
function getClienteTexto(r) {
  const parts = [
    r.UEMAIL, r.uemail,
    r.EMAIL, r.email,
    r.CONTACTO_EMAIL, r.contacto_email,
    r.NOMBRE, r.nombre,
    r.CONTACTO_NOMBRE, r.contacto_nombre,
  ].filter(Boolean);
  return parts.join(" ").toLowerCase();
}
function getStartDate(r) {
  const ts = r.START_TS ?? r.start_ts ?? r.INICIO ?? r.inicio;
  if (ts) return toDate(ts);

  const fecha = r.FECHA ?? r.fecha;
  if (!fecha) return null;
  try {
    const base = new Date(fecha);
    const h = (r.HORA_INICIO ?? r.hora_inicio ?? "00:00");
    const [hh, mm] = String(h).split(":").map(x => parseInt(x || "0", 10));
    base.setHours(hh || 0, mm || 0, 0, 0);
    return base;
  } catch { return null; }
}
/* ==================================================================== */

// ✅ CORREGIDO: Mantener todos los filtros de estado
const estadosOpts = [
  { v: "", t: "Todos" },
  { v: "RESERVADO", t: "Reservado" },
  { v: "CANCELADO", t: "Cancelado" },
];

/* ===== Helpers: exportación ===== */
async function exportarPDF(payload) {
  const url = `${API_BASE}/api/pdf/reportes-eventos`;
  const { data } = await axios.post(url, payload, {
    responseType: "blob",
    headers: { ...authHeaders() },
  });
  const blob = new Blob([data], { type: "application/pdf" });
  const link = document.createElement("a");
  link.href = URL.createObjectURL(blob);
  link.download = "reportes_eventos.pdf";
  link.click();
  URL.revokeObjectURL(link.href);
}
async function exportarExcel(payload) {
  const url = `${API_BASE}/api/excel/reportes-eventos`;
  const { data } = await axios.post(url, payload, {
    responseType: "blob",
    headers: { ...authHeaders() },
  });
  const blob = new Blob([data], {
    type: "application/vnd.openxmlformats-officedocument.spreadsheetml.sheet",
  });
  const link = document.createElement("a");
  link.href = URL.createObjectURL(blob);
  link.download = "reportes_eventos.xlsx";
  link.click();
  URL.revokeObjectURL(link.href);
}

/* ===== Mapeo de detalle para exportar (filas planas) ===== */
const mapRowToExport = (r) => {
  const d  = getStartDate(r);
  const st = getEstado(r);
  const sala = getSalaNombre(r);
  const monto = Number(r.MONTO_GTQ ?? r.MONTO ?? r.monto ?? 0);
  const cliente = [
    r.CONTACTO_NOMBRE ?? r.NOMBRE ?? "",
    r.CONTACTO_EMAIL ? `<${r.CONTACTO_EMAIL}>` : (r.UEMAIL ? `<${r.UEMAIL}>` : "")
  ].filter(Boolean).join(" ");
  const z = (n) => String(n).padStart(2,"0");
  const fmt = d ? `${d.getFullYear()}-${z(d.getMonth()+1)}-${z(d.getDate())} ${z(d.getHours())}:${z(d.getMinutes())}` : "";
  return {
    fecha: fmt,
    sala: sala || "",
    estado: st || "",
    cliente,
    personas: r.PERSONAS ?? r.personas ?? "",
    monto: Number.isFinite(monto) ? Number(monto).toFixed(2) : "0.00",
    notas: r.NOTAS ?? r.DESCRIPCION ?? r.notas ?? "",
  };
};

export default function ReportesEventos() {
  const now = new Date();
  const yyyy = now.getFullYear();
  const mm = String(now.getMonth() + 1).padStart(2, "0");
  const firstDay = `${yyyy}-${mm}-01`;
  const lastDay = new Date(yyyy, now.getMonth() + 1, 0).toISOString().slice(0, 10);

  const [desde, setDesde] = useState(firstDay);
  const [hasta, setHasta] = useState(lastDay);

  const [salaId, setSalaId] = useState("");
  const [salaNombreSel, setSalaNombreSel] = useState("");

  // ✅ CORREGIDO: Estado por defecto vacío para mostrar todos
  const [estado, setEstado] = useState("");
  const [cliente, setCliente] = useState("");

  const [salas, setSalas] = useState([]);
  const [rowsRaw, setRowsRaw] = useState([]);
  const [loading, setLoading] = useState(false);

  const refDias = useRef(null);
  const refHoras = useRef(null);
  const refSemanas = useRef(null);

  useEffect(() => {
    (async () => {
      try {
        const { data } = await axios.get(`${API_BASE}/api/salas`, { headers: authHeaders() });
        const list = Array.isArray(data) ? data : (data?.salas || []);
        setSalas(list);
      } catch {
        setSalas([]);
      }
    })();
  }, []);

  const buscar = async () => {
    setLoading(true);
    try {
      const p = {};
      if (desde) p.desde = desde;
      if (hasta) p.hasta = hasta;

      const sidParsed = parseInt(String(salaId).trim(), 10);
      if (Number.isInteger(sidParsed) && sidParsed > 0) {
        p.salaId = sidParsed;
      }
      
      // ✅ CORREGIDO: Enviar parámetro estado al backend
      const est = String(estado || "").toUpperCase();
      if (est) { 
        p.estado = est; 
      }
      
      if (cliente?.trim()) p.cliente = cliente.trim();

      const { data } = await axios.get(`${API_BASE}/api/reportes/eventos`, {
        params: p,
        headers: authHeaders(),
      });

      const itemsRaw = Array.isArray(data) ? data : (data?.rows || data?.eventos || []);
      setRowsRaw(itemsRaw);
    } catch {
      setRowsRaw([]);
    } finally {
      setLoading(false);
    }
  };

  useEffect(() => { buscar(); /* eslint-disable-line react-hooks/exhaustive-deps */ }, []);

  // ======================== FILTROS EN MEMORIA =========================
  const filteredRows = useMemo(() => {
    const dDesde = desde ? new Date(desde + "T00:00:00") : null;
    const dHasta = hasta ? new Date(hasta + "T23:59:59") : null;

    const sidParsed = parseInt(String(salaId).trim(), 10);
    const hasSid = Number.isInteger(sidParsed) && sidParsed > 0;

    const selectedNameNorm = normalizeSalaName(
      salaNombreSel ||
      (hasSid
        ? normalizeSalaName(
            salas.find(s => (s.ID ?? s.ID_SALA ?? s.id) == sidParsed)?.NOMBRE ??
            salas.find(s => (s.ID ?? s.ID_SALA ?? s.id) == sidParsed)?.nombre ?? ""
          )
        : "")
    );

    const est = String(estado || "").toUpperCase();
    const cli = (cliente || "").trim().toLowerCase();

    return rowsRaw.filter(r => {
      if (hasSid || selectedNameNorm) {
        const rsid = getSalaId(r);
        const rname = getSalaNombre(r);

        let salaOk = true;
        if (hasSid) salaOk = (rsid !== null && Number(rsid) === sidParsed);
        if (!salaOk) {
          if (selectedNameNorm) {
            salaOk = rname === selectedNameNorm ||
                     (selectedNameNorm === "SALA A" && rname === "SALA 9") ||
                     (selectedNameNorm === "SALA 9" && rname === "SALA A");
          }
        }
        if (!salaOk) return false;
      }

      // ✅ CORREGIDO: Filtrar por estado si está seleccionado
      if (est) {
        const re = getEstado(r);
        if (re !== est) return false;
      }

      if (cli) {
        if (!getClienteTexto(r).includes(cli)) return false;
      }

      const sd = getStartDate(r);
      if (dDesde && (!sd || sd < dDesde)) return false;
      if (dHasta && (!sd || sd > dHasta)) return false;

      return true;
    });
  }, [rowsRaw, salas, salaId, salaNombreSel, estado, cliente, desde, hasta]);

  // ---------- KPIs ----------
  const kpis = useMemo(() => {
    const rows = filteredRows;
    const total = rows.length;
    let pagadosQ = 0, pagadosN = 0, reservasN = 0, canceladosN = 0;

    rows.forEach(r => {
      const estTabla = String(r.ESTADO || r.estado || "").toUpperCase();
      const estFact  = String(r.ESTADO_FACT || estTabla).toUpperCase();
      const monto = Number(r.MONTO_GTQ ?? r.MONTO ?? r.monto ?? 0);

      const tienePago =
        Number(r.TIENE_PAGO || 0) === 1 ||
        monto > 0 ||
        estFact === "PAGADO";

      if (tienePago) { 
        pagadosQ += monto; 
        pagadosN++; 
      }
      if (estTabla === "RESERVADO") reservasN++;
      if (estTabla === "CANCELADO") canceladosN++;
    });

    const ocupacion = total > 0 ? (pagadosN / total) * 100 : 0;
    const ticketProm = pagadosN > 0 ? (pagadosQ / pagadosN) : 0;

    return { 
      ocupacion, 
      ingresosMes: pagadosQ, 
      reservasTotales: reservasN,
      canceladosTotales: canceladosN,
      eventosTotales: total,
      ticketPromedio: ticketProm 
    };
  }, [filteredRows]);

  // ---------- Días con mayor demanda ----------
  const dataPorDia = useMemo(() => {
    const dias = ["Lunes","Martes","Miércoles","Jueves","Viernes","Sábado","Domingo"];
    const counts = Array(7).fill(0);
    filteredRows.forEach(r => {
      const d = getStartDate(r);
      if (!d) return;
      let idx = d.getDay();
      idx = (idx === 0) ? 6 : idx - 1;
      counts[idx]++;
    });
    return { labels: dias, counts };
  }, [filteredRows]);

  // ---------- Horarios más solicitados ----------
  const dataPorHora = useMemo(() => {
    const labels = Array.from({length: 13}, (_,i)=> (8+i).toString().padStart(2,'0') + ":00"); // 08..20
    const counts = Array(labels.length).fill(0);
    filteredRows.forEach(r => {
      const d = getStartDate(r);
      if (!d) return;
      const h = d.getHours();
      if (h >= 8 && h <= 20) counts[h-8]++;
    });
    return { labels, counts };
  }, [filteredRows]);

  // ---------- Ingresos por semana ----------
  const dataPorSemana = useMemo(() => {
    const map = new Map();
    filteredRows.forEach(r => {
      const estTabla = String(r.ESTADO || "").toUpperCase();
      const estFact  = String(r.ESTADO_FACT || estTabla).toUpperCase();
      const monto = Number(r.MONTO_GTQ ?? r.MONTO ?? r.monto ?? 0);

      const tienePago =
        Number(r.TIENE_PAGO || 0) === 1 ||
        monto > 0 ||
        estFact === "PAGADO";

      if (!tienePago) return;

      const d = getStartDate(r);
      if (!d) return;

      const key = weekKey(d);
      map.set(key, (map.get(key) || 0) + monto);
    });
    const labels = Array.from(map.keys()).sort();
    const series = labels.map(k => map.get(k));
    return { labels, series };
  }, [filteredRows]);

  // ---------- Chart.js v3+ options (actualizado) ----------
  const barOptions = {
    maintainAspectRatio: false,
    plugins: { legend: { display: false } },
    scales: {
      y: { beginAtZero: true },
      x: { grid: { display: false } },
    },
  };
  const lineOptions = {
    maintainAspectRatio: false,
    plugins: { legend: { display: true, position: "top" } },
    scales: {
      y: { beginAtZero: true },
      x: { grid: { display: false } },
    },
    elements: { line: { tension: 0.25 }, point: { radius: 3 } },
  };
  const moneyOptions = {
    maintainAspectRatio: false,
    plugins: {
      legend: { display: true, position: "top" },
      tooltip: {
        callbacks: {
          label: (ctx) => `Ingresos: Q ${Number(ctx.parsed.y || 0).toFixed(2)}`
        }
      }
    },
    scales: {
      y: {
        beginAtZero: true,
        ticks: { callback: (v) => `Q ${v}` },
      },
      x: { grid: { display: false } },
    },
    elements: { line: { tension: 0.25 }, point: { radius: 3 } },
  };

  // ---------- datasets ----------
  const diasDataset = {
    labels: dataPorDia.labels,
    datasets: [{ label: "Eventos", data: dataPorDia.counts, backgroundColor: "rgba(124, 58, 237, 0.35)" }],
  };
  const horasDataset = {
    labels: dataPorHora.labels,
    datasets: [{ label: "Solicitudes", data: dataPorHora.counts, fill: true, borderColor: "rgba(124,58,237,0.8)", backgroundColor: "rgba(124,58,237,0.15)" }],
  };
  const semanasDataset = {
    labels: dataPorSemana.labels,
    datasets: [{ label: "Ingresos (Q)", data: dataPorSemana.series, fill: true, borderColor: "rgba(16,185,129,0.9)", backgroundColor: "rgba(16,185,129,0.15)" }],
  };
  const semanasBarDataset = {
    labels: dataPorSemana.labels,
    datasets: [{
      label: "Ingresos (Q)",
      data: dataPorSemana.series,
      backgroundColor: "rgba(16,185,129,0.25)",
      borderColor: "rgba(16,185,129,0.9)",
      borderWidth: 1,
    }],
  };

  /* ====== handlers de exportación ====== */
  const onExportPDF = async () => {
    const detalle = filteredRows.map(mapRowToExport);
    const filtros = {
      desde, hasta,
      salaId: salaId || null,
      salaNombre: salaNombreSel || "",
      estado,
      cliente,
    };
    const charts = {
      imgDias: refDias.current?.toBase64Image?.("image/png", 1),
      imgHoras: refHoras.current?.toBase64Image?.("image/png", 1),
      imgSemanas: refSemanas.current?.toBase64Image?.("image/png", 1),
    };
    await exportarPDF({ filtros, kpis, detalle, charts });
  };

  const onExportExcel = async () => {
    const detalle = filteredRows.map(mapRowToExport);
    const filtros = {
      desde, hasta,
      salaId: salaId || null,
      salaNombre: salaNombreSel || "",
      estado,
      cliente,
    };
    const charts = {
      imgDias: refDias.current?.toBase64Image?.("image/png", 1),
      imgHoras: refHoras.current?.toBase64Image?.("image/png", 1),
      imgSemanas: refSemanas.current?.toBase64Image?.("image/png", 1),
    };
    await exportarExcel({ filtros, kpis, detalle, charts });
  };

  return (
    <div className="revent-container">
      <div className="revent-header">
        <h2>Reportes de Eventos</h2> {/* ✅ CORREGIDO: Título general */}

        <div className="rds-actions">
          <button type="button" className="btn-export pdf" onClick={onExportPDF}>
            <span className="ico">📄</span> Exportar a PDF
          </button>
          <button type="button" className="btn-export excel" onClick={onExportExcel}>
            <span className="ico">📊</span> Exportar a Excel
          </button>
        </div>

        <div className="revent-filters">
          <div>
            <label>Desde</label>
            <input type="date" value={desde} onChange={e=>setDesde(e.target.value)} />
          </div>
          <div>
            <label>Hasta</label>
            <input type="date" value={hasta} onChange={e=>setHasta(e.target.value)} />
          </div>

          <div>
            <label>Sala</label>
            <select
              value={salaId}
              onChange={e => {
                const v = e.target.value;
                const opt = e.target.selectedOptions?.[0];
                const nombreOpt = opt?.dataset?.nombre || opt?.text || "";
                setSalaNombreSel(normalizeSalaName(nombreOpt));
                setSalaId(v === "" ? "" : Number(v));
              }}
            >
              <option value="">Todas</option>
              {salas.map(s => {
                const id = s.ID ?? s.ID_SALA ?? s.id;
                const nombre = s.NOMBRE ?? s.nombre ?? "";
                return (
                  <option key={id} value={id} data-nombre={nombre}>
                    {nombre}
                  </option>
                );
              })}
            </select>
          </div>

          {/* ✅ CORREGIDO: Select de estado con todos los filtros */}
          <div>
            <label>Estado</label>
            <select value={estado} onChange={e=>setEstado(e.target.value)}>
              {estadosOpts.map(o => <option key={o.v} value={o.v}>{o.t}</option>)}
            </select>
          </div>

          <div className="grow">
            <label>Cliente (email/nombre)</label>
            <input type="text" value={cliente} onChange={e=>setCliente(e.target.value)} placeholder="Buscar…" />
          </div>

          <button onClick={buscar} disabled={loading}>
            {loading ? "Buscando…" : "Buscar"}
          </button>
        </div>
      </div>

      {/* KPIs */}
      <div className="revent-kpis">
        <div className="kpi-card">
          <p>TASA DE OCUPACIÓN</p>
          <h3 style={{ color: "#9333ea" }}>{kpis.ocupacion.toFixed(0)}%</h3>
          <span className="kpi-sub">PAGADOS / eventos</span>
        </div>
        <div className="kpi-card">
          <p>INGRESOS DEL PERÍODO</p>
          <h3 style={{ color: "#10b981" }}>{fmtQ(kpis.ingresosMes.toFixed(2))}</h3>
          <span className="kpi-sub">Eventos pagados</span>
        </div>
        <div className="kpi-card">
          <p>EVENTOS TOTALES</p>
          <h3 style={{ color: "#2563eb" }}>{kpis.eventosTotales}</h3>
          <span className="kpi-sub">Total de eventos</span>
        </div>
        <div className="kpi-card">
          <p>TICKET PROMEDIO</p>
          <h3 style={{ color: "#f59e0b" }}>{fmtQ(kpis.ticketPromedio.toFixed(2))}</h3>
          <span className="kpi-sub">Ingresos / pagados</span>
        </div>
      </div>

      {/* Gráficas superiores */}
      <div className="revent-grid2">
        <div className="card">
          <div className="card-title">Días con Mayor Demanda</div>
          <div className="card-chart">
            <Bar ref={refDias} data={diasDataset} options={barOptions} />
          </div>
        </div>
        <div className="card">
          <div className="card-title">Horarios Más Solicitados</div>
          <div className="card-chart">
            <Line ref={refHoras} data={horasDataset} options={lineOptions} />
          </div>
        </div>
      </div>

      {/* Ingresos por semana */}
      <div className="card">
        <div className="card-title">💰 Ingresos por Semana</div>
        <div className="card-chart big">
          {dataPorSemana.labels.length >= 2 ? (
            <Line ref={refSemanas} data={semanasDataset} options={moneyOptions} />
          ) : (
            <Bar ref={refSemanas} data={semanasBarDataset} options={moneyOptions} />
          )}
        </div>
      </div>
    </div>
  );
}