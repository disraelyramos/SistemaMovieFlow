import React, { useEffect, useMemo, useState, useRef } from "react";
import axios from "axios";
import "../../styles/graficas_reportes/reportes_de_sala.css";

/* ===== Chart.js ===== */
import { Bar, Line } from "react-chartjs-2";
import {
  Chart as ChartJS,
  LineElement,
  BarElement,
  PointElement,
  CategoryScale,
  LinearScale,
  Tooltip,
  Legend,
  Filler,
} from "chart.js";
ChartJS.register(LineElement, BarElement, PointElement, CategoryScale, LinearScale, Tooltip, Legend, Filler);

/* ===== API BASE ===== */
const API_BASE =
  import.meta?.env?.VITE_API_BASE ||
  import.meta?.env?.VITE_API_BASE_URL ||
  import.meta?.env?.VITE_API_URL ||
  "http://localhost:3001";

/* ===== Axios client ===== */
const client = axios.create({ baseURL: API_BASE, withCredentials: false });

/* ===== Utils ===== */
const fmtPct = (v) => `${Number(v || 0).toFixed(1)}%`;

/* ===== Helper: exportar PDF ===== */
async function exportarPDF({ kpis, ocupacion, tendencia, detalle, charts, salaSel }) {
  const url = `${API_BASE}/api/pdf/reportes-de-sala`;
  const { data } = await axios.post(
    url,
    {
      filtros: { sala: salaSel },
      kpis,
      ocupacion,
      tendencia,
      detalle,
      charts,
    },
    { responseType: "blob" }
  );
  const blob = new Blob([data], { type: "application/pdf" });
  const link = document.createElement("a");
  link.href = URL.createObjectURL(blob);
  link.download = "reportes_de_sala.pdf";
  link.click();
  URL.revokeObjectURL(link.href);
}

/* ===== Helper: exportar EXCEL ===== */
async function exportarExcel({ kpis, ocupacion, tendencia, detalle, charts, salaSel }) {
  const url = `${API_BASE}/api/excel/reportes-de-sala`;
  const { data } = await axios.post(
    url,
    {
      filtros: { sala: salaSel },
      kpis,
      ocupacion,
      tendencia,
      detalle,
      charts,
    },
    { responseType: "blob" }
  );
  const blob = new Blob([data], {
    type: "application/vnd.openxmlformats-officedocument.spreadsheetml.sheet",
  });
  const link = document.createElement("a");
  link.href = URL.createObjectURL(blob);
  link.download = "reportes_de_sala.xlsx";
  link.click();
  URL.revokeObjectURL(link.href);
}

/* ===== Plugin: fondo blanco para exportación ===== */
const pluginFondoBlanco = {
  id: "bgWhite",
  beforeDraw(c) {
    const { ctx, width, height } = c;
    ctx.save();
    ctx.globalCompositeOperation = "destination-over";
    ctx.fillStyle = "#ffffff";
    ctx.fillRect(0, 0, width, height);
    ctx.restore();
  },
};

/* ===== Helper: obtener imagen base64 del chart ===== */
async function getChartImage(chartRef) {
  await new Promise((r) => setTimeout(r, 20));
  const chart = chartRef.current;
  if (!chart) return null;
  chart.update();
  const canvas = chart.canvas;
  if (!canvas) return null;
  return canvas.toDataURL("image/png", 1.0);
}

/* ===== Paleta de colores suaves para gráficas ===== */
const COLORS = {
  capacidad: '#E5E7EB',      // Gris suave para capacidad
  vendidos: '#93C5FD',       // Azul pastel suave
  reservados: '#FCD34D',     // Amarillo pastel suave
  tendencia: '#86EFAC',      // Verde pastel suave para tendencia
  tendenciaLine: '#059669',  // Verde más definido para la línea
};

/* ===== Colores hover ===== */
const COLORS_HOVER = {
  capacidad: '#D1D5DB',
  vendidos:  '#60A5FA',
  reservados:'#FBBF24',
  tendencia: '#4ADE80',
  tendenciaLine: '#047857',  // (opcional) hover para la línea de tendencia
};

export default function ReportesDeSala() {
  /* -------- filtro de sala (único) -------- */
  const [salaSel, setSalaSel] = useState("ALL");
  const [salas, setSalas] = useState([]);

  /* -------- datos -------- */
  const [kpis, setKpis] = useState({
    ocupacionPromedio15d: 0,
    totalAsientos: 0,
    asientosOcupadosHoy: 0,
    salasActivas: 0,
  });
  const [ocupacionPorSala, setOcupacionPorSala] = useState([]);
  const [tendenciaSemanal, setTendenciaSemanal] = useState([]);
  const [detalle, setDetalle] = useState([]);
  const [loading, setLoading] = useState(false);

  /* -------- refs para charts -------- */
  const barRef = useRef(null);
  const lineRef = useRef(null);

  /* ====== cargar datos ====== */
  async function cargarDatos() {
    setLoading(true);
    try {
      const [k, o, t, d] = await Promise.all([
        client.get("/api/reportes-salas/kpis-salas"),
        client.get("/api/reportes-salas/ocupacion-por-sala-hoy"),
        client.get("/api/reportes-salas/tendencia-semanal"),
        client.get("/api/reportes-salas/detalle-ocupacion"),
      ]);

      setKpis(k.data || {});
      setOcupacionPorSala(o.data || []);
      setTendenciaSemanal(t.data || []);
      setDetalle(d.data || []);

      // poblar combo de salas (único filtro)
      const nombres = Array.from(new Set((o.data || []).map((r) => r.SALA))).sort();
      setSalas(nombres.map((n) => ({ id: n, nombre: n })));
    } catch (err) {
      console.error("Error cargando reportería salas:", err);
    } finally {
      setLoading(false);
    }
  }

  /* ===== carga inicial + auto-refresh ===== */
  useEffect(() => {
    let timerId;
    const REFRESH_MS = 10000;

    const init = async () => {
      await cargarDatos();
      timerId = setInterval(cargarDatos, REFRESH_MS);
    };
    init();

    const onVisibility = () => {
      if (document.visibilityState === "visible") cargarDatos();
    };
    document.addEventListener("visibilitychange", onVisibility);

    return () => {
      if (timerId) clearInterval(timerId);
      document.removeEventListener("visibilitychange", onVisibility);
    };
  }, []);

  /* ===== aplicar filtro local de sala ===== */
  const ocupacionFiltrada = useMemo(() => {
    if (salaSel === "ALL") return ocupacionPorSala;
    return (ocupacionPorSala || []).filter((x) => x.SALA === salaSel);
  }, [ocupacionPorSala, salaSel]);

  const detalleFiltrado = useMemo(() => {
    if (salaSel === "ALL") return detalle || [];
    return (detalle || []).filter((r) => r.SALA === salaSel);
  }, [detalle, salaSel]);

  /* ===== datasets ===== */
  const barData = useMemo(() => {
    const labels = (ocupacionFiltrada || []).map((r) => r.SALA);
    const capacidad = (ocupacionFiltrada || []).map((r) => Number(r.CAPACIDAD || 0));
    // Backend devuelve columnas en mayúsculas (OUT_FORMAT_OBJECT)
    const vendidos = (ocupacionFiltrada || []).map((r) => Number(r.VENDIDOS ?? r.vendidos ?? 0));
    const reservados = (ocupacionFiltrada || []).map((r) => Number(r.RESERVADOS ?? r.reservados ?? 0));

    return {
      labels,
      datasets: [
        { 
          label: "Capacidad", 
          data: capacidad, 
          borderWidth: 1, 
          backgroundColor: COLORS.capacidad,
          borderColor: COLORS.capacidad,
          hoverBackgroundColor: COLORS_HOVER.capacidad,
          hoverBorderColor: COLORS_HOVER.capacidad,
          borderRadius: 4
        },
        { 
          label: "Vendidos", 
          data: vendidos, 
          borderWidth: 1, 
          backgroundColor: COLORS.vendidos,
          borderColor: COLORS.vendidos,
          hoverBackgroundColor: COLORS_HOVER.vendidos,
          hoverBorderColor: COLORS_HOVER.vendidos,
          borderRadius: 4
        },
        { 
          label: "Reservados", 
          data: reservados, 
          borderWidth: 1, 
          backgroundColor: COLORS.reservados,
          borderColor: COLORS.reservados,
          hoverBackgroundColor: COLORS_HOVER.reservados,
          hoverBorderColor: COLORS_HOVER.reservados,
          borderRadius: 4
        },
      ],
    };
  }, [ocupacionFiltrada]);

  const lineData = useMemo(() => {
    const labels = (tendenciaSemanal || []).map((r) =>
      new Date(r.DIA || r.dia || Date.now()).toLocaleDateString("es-GT", { weekday: "short" })
    );
    const pct = (tendenciaSemanal || []).map((r) => Number(r.PCT_OCUPACION || r.pct_ocupacion || 0));

    return {
      labels,
      datasets: [
        {
          label: "% Ocupación",
          data: pct,
          fill: true,
          tension: 0.35,
          backgroundColor: "rgba(134, 239, 172, 0.2)",
          borderColor: COLORS.tendenciaLine,
          pointBackgroundColor: COLORS.tendenciaLine,
          pointBorderColor: "#ffffff",
          pointBorderWidth: 2,
          pointRadius: 5,
          pointHoverRadius: 7,
          pointHoverBackgroundColor: COLORS.tendenciaLine,
          pointHoverBorderColor: "#ffffff",
        },
      ],
    };
  }, [tendenciaSemanal]);

  const barOpts = {
    responsive: true,
    plugins: { 
      legend: { 
        position: "top",
        labels: {
          usePointStyle: true,
          padding: 15,
          font: {
            size: 12,
            weight: '500'
          }
        }
      } 
    },
    scales: { 
      y: { 
        beginAtZero: true, 
        ticks: { precision: 0 },
        grid: {
          color: 'rgba(0, 0, 0, 0.05)'
        }
      }, 
      x: { 
        grid: { display: false } 
      } 
    },
    maintainAspectRatio: false,
  };

  const lineOpts = {
    responsive: true,
    plugins: {
      legend: { 
        display: true, 
        position: "top",
        labels: {
          usePointStyle: true,
          padding: 15,
          font: {
            size: 12,
            weight: '500'
          }
        }
      },
      tooltip: { 
        callbacks: { 
          label: (ctx) => `${Number(ctx.raw || 0).toFixed(1)}%` 
        },
        backgroundColor: 'rgba(255, 255, 255, 0.95)',
        titleColor: '#1F2937',
        bodyColor: '#374151',
        borderColor: '#E5E7EB',
        borderWidth: 1
      },
    },
    scales: { 
      y: { 
        beginAtZero: true, 
        max: 100, 
        ticks: { 
          callback: (v) => `${v}%` 
        },
        grid: {
          color: 'rgba(0, 0, 0, 0.05)'
        }
      }, 
      x: { 
        grid: { display: false } 
      } 
    },
    maintainAspectRatio: false,
  };

  /* ====== UI ====== */
  return (
    <div className="rds container" style={{ padding: 16 }}>
      {/* ===== Filtro de Sala (único) ===== */}
      <div className="rds-filtros" style={{ display: "flex", gap: 12, flexWrap: "wrap", marginBottom: 12 }}>
        <div>
          <label className="lbl">Sala</label>
          <select value={salaSel} onChange={(e) => setSalaSel(e.target.value)} className="inp">
            <option value="ALL">Todas las Salas</option>
            {salas.map((s) => (
              <option key={s.id} value={s.nombre}>
                {s.nombre}
              </option>
            ))}
          </select>
        </div>
      </div>

      {/* ===== Acciones ===== */}
      <div className="rds-actions">
        <button
          type="button"
          className="btn-export pdf"
          onClick={async () => {
            const [imgOcupacion, imgTendencia] = await Promise.all([getChartImage(barRef), getChartImage(lineRef)]);
            await exportarPDF({
              kpis,
              ocupacion: ocupacionPorSala,
              tendencia: tendenciaSemanal,
              detalle,
              salaSel,
              charts: { imgOcupacion, imgTendencia },
            });
          }}
        >
          <span className="ico">📄</span> Exportar a PDF
        </button>

        <button
          type="button"
          className="btn-export excel"
          onClick={async () => {
            const [imgOcupacion, imgTendencia] = await Promise.all([getChartImage(barRef), getChartImage(lineRef)]);
            await exportarExcel({
              kpis,
              ocupacion: ocupacionPorSala,
              tendencia: tendenciaSemanal,
              detalle,
              salaSel,
              charts: { imgOcupacion, imgTendencia },
            });
          }}
        >
          <span className="ico">📊</span> Exportar a Excel
        </button>
      </div>

      {/* ===== KPIs ===== */}
      <div className="rds-kpis" style={{ display: "grid", gridTemplateColumns: "repeat(4, 1fr)", gap: 12 }}>
        <KPI title="OCUPACIÓN PROMEDIO" subtitle="Últimos 15 días" value={fmtPct(kpis.ocupacionPromedio15d)} />
        <KPI title="TOTAL ASIENTOS" subtitle="Capacidad total" value={kpis.totalAsientos} />
        <KPI title="ASIENTOS VENDIDOS" subtitle="Hoy" value={kpis.asientosOcupadosHoy} />
        <KPI title="SALAS ACTIVAS" subtitle="En operación" value={kpis.salasActivas} />
      </div>

      {/* ===== Gráficas ===== */}
      <div className="rds-charts" style={{ display: "grid", gridTemplateColumns: "1fr 1fr", gap: 12, marginTop: 12 }}>
        <Card title="Ocupación por Sala">
          <div style={{ height: 280 }}>
            <Bar ref={barRef} data={barData} options={barOpts} plugins={[pluginFondoBlanco]} />
          </div>
        </Card>
        <Card title="Tendencia Semanal">
          <div style={{ height: 280 }}>
            <Line ref={lineRef} data={lineData} options={lineOpts} plugins={[pluginFondoBlanco]} />
          </div>
        </Card>
      </div>

      {/* ===== Tabla Detalle ===== */}
      <div className="rds-table card" style={{ marginTop: 16 }}>
        <div className="card-head">
          <h3>Detalle de Ocupación por Sala y Día</h3>
        </div>
        <div className="table-wrap" style={{ overflowX: "auto" }}>
          <table className="tbl">
            <thead>
              <tr>
                <th>SALA</th>
                <th>DÍA</th>
                <th>CAPACIDAD</th>
                <th>OCUPADOS</th>
                <th>DISPONIBLES</th>
                <th>% OCUPACIÓN</th>
                <th>ESTADO</th>
              </tr>
            </thead>
            <tbody>
              {detalleFiltrado.map((r, i) => (
                <tr key={i}>
                  <td>{r.SALA}</td>
                  <td>{(r.DIA_SEMANA || r.dia_semana || "").trim()}</td>
                  <td>{r.CAPACIDAD}</td>
                  <td>{r.OCUPADOS}</td>
                  <td>{r.DISPONIBLES}</td>
                  <td>
                    <div className="pct-cell">
                      <div className="bar">
                        <div className="fill" style={{ width: `${Number(r.PCT_OCUPACION || 0)}%` }} />
                      </div>
                      <span className="pct">{fmtPct(r.PCT_OCUPACION)}</span>
                    </div>
                  </td>
                  <td>
                    <span className={`badge ${String(r.ESTADO || "").toLowerCase()}`}>{r.ESTADO}</span>
                  </td>
                </tr>
              ))}
              {!detalleFiltrado.length && (
                <tr>
                  <td colSpan="7" style={{ textAlign: "center", padding: 16 }}>
                    Sin datos.
                  </td>
                </tr>
              )}
            </tbody>
          </table>
        </div>
      </div>

      {loading && <div style={{ marginTop: 8, fontSize: 12, color: "#6b7280" }}>Actualizando…</div>}
    </div>
  );
}

/* ================== Subcomponentes ================== */
function KPI({ title, subtitle, value }) {
  return (
    <div className="card" style={{ padding: 16 }}>
      <div className="kpi-title">{title}</div>
      <div className="kpi-value">{value}</div>
      <div className="kpi-sub">{subtitle}</div>
    </div>
  );
}

function Card({ title, children }) {
  return (
    <div className="card" style={{ padding: 16 }}>
      <div className="card-head">
        <h3>{title}</h3>
      </div>
      {children}
    </div>
  );
}