import React, { useEffect, useMemo, useState } from "react";
import axios from "axios";

/* Chart.js */
import { Doughnut, Bar } from "react-chartjs-2";
import {
  Chart as ChartJS,
  ArcElement,
  BarElement,
  CategoryScale,
  LinearScale,
  Tooltip,
  Legend,
} from "chart.js";
ChartJS.register(ArcElement, BarElement, CategoryScale, LinearScale, Tooltip, Legend);

/* Estilos */
import "../../styles/graficas_reportes/ventas-categoria.css";

/* Config API */
const API_BASE =
  import.meta?.env?.VITE_API_BASE ||
  import.meta?.env?.VITE_API_BASE_URL ||
  import.meta?.env?.VITE_API_URL ||
  "http://localhost:3001";

/* Helpers */
const fmtGTQ = (n) =>
  new Intl.NumberFormat("es-GT", { style: "currency", currency: "GTQ", maximumFractionDigits: 2 })
    .format(Number(n || 0));
const pad2 = (n) => String(n).padStart(2, "0");
function currentMonthRange() {
  const now = new Date();
  const y = now.getFullYear(), m = now.getMonth();
  const first = new Date(y, m, 1), last = new Date(y, m + 1, 0);
  return {
    desde: `${pad2(first.getDate())}/${pad2(first.getMonth() + 1)}/${first.getFullYear()}`,
    hasta: `${pad2(last.getDate())}/${pad2(last.getMonth() + 1)}/${last.getFullYear()}`,
  };
}
function isValidCurrentMonthRange(desde, hasta) {
  const [dD, dM, dY] = (desde||"").split("/").map(Number);
  const [hD, hM, hY] = (hasta||"").split("/").map(Number);
  const d = new Date(dY, dM - 1, dD), h = new Date(hY, hM - 1, hD);
  const now = new Date();
  return (
    dY === hY && dM === hM &&
    dY === now.getFullYear() && (dM - 1) === now.getMonth() &&
    d <= h
  );
}

/* Paleta de colores suaves y elegantes */
const COLORS = {
  snacks_caja: '#93C5FD',     // Azul pastel suave
  combos_caja: '#FCA5A5',     // Rosa pastel suave
  snacks_cliente: '#86EFAC',  // Verde pastel suave
  combos_cliente: '#FCD34D',  // Amarillo pastel suave
};

/* Colores para hover effects - versión un poco más intensa pero suave */
const COLORS_HOVER = {
  snacks_caja: '#60A5FA',
  combos_caja: '#F87171',
  snacks_cliente: '#4ADE80',
  combos_cliente: '#FBBF24',
};

/* Componente */
export default function ReporteventasCategoria() {
  const [filtros, setFiltros] = useState(currentMonthRange());
  const [loading, setLoading] = useState(false);
  const [err, setErr] = useState("");
  const [resp, setResp] = useState(null);

  const onChange = (e) => setFiltros((s) => ({ ...s, [e.target.name]: e.target.value }));

  const fetchData = async () => {
    setErr("");
    if (!isValidCurrentMonthRange(filtros.desde, filtros.hasta)) {
      setErr("El rango debe pertenecer al mes actual y ser válido (DD/MM/YYYY).");
      return;
    }
    setLoading(true);
    try {
      const { data } = await axios.get(`${API_BASE}/api/reportes/ventas-snacks`, { params: filtros });
      if (!data?.ok) throw new Error(data?.error || "Respuesta inválida");
      setResp(data);
    } catch (e) {
      setErr(e?.response?.data?.error || e.message || "Error al cargar datos");
    } finally {
      setLoading(false);
    }
  };

  useEffect(() => { fetchData(); }, []); // carga inicial

  /* Exportaciones */
  const exportPDF = async () => {
    try {
      const { data: blob } = await axios.get(`${API_BASE}/api/reportes/ventas-snacks/pdf`, {
        params: filtros, responseType: "blob"
      });
      const url = URL.createObjectURL(new Blob([blob], { type: "application/pdf" }));
      const a = document.createElement("a"); a.href = url; a.download = "reporte_ventas_categoria.pdf"; a.click();
      URL.revokeObjectURL(url);
    } catch { alert("No se pudo exportar a PDF."); }
  };
  const exportExcel = async () => {
    try {
      const { data: blob } = await axios.get(`${API_BASE}/api/reportes/ventas-snacks/excel`, {
        params: filtros, responseType: "blob"
      });
      const url = URL.createObjectURL(new Blob([blob], { type: "application/vnd.openxmlformats-officedocument.spreadsheetml.sheet" }));
      const a = document.createElement("a"); a.href = url; a.download = "reporte_ventas_categoria.xlsx"; a.click();
      URL.revokeObjectURL(url);
    } catch { alert("No se pudo exportar a Excel."); }
  };

  /* Derivados para UI */
  const t = resp?.totales || {};
  const p = resp?.participacion || {};
  const m = resp?.variacion_mom || {};

  // Nombres exactos solicitados
  const cards = [
    { key:"snacks_caja",    title:"Snack",          total:t.snacks_caja||0,    pct:p.snacks_caja??0,    mom:m.snacks_caja },
    { key:"combos_caja",    title:"Combo",          total:t.combos_caja||0,    pct:p.combos_caja??0,    mom:m.combos_caja },
    { key:"snacks_cliente", title:"Snack (Sala)",   total:t.snacks_cliente||0, pct:p.snacks_cliente??0, mom:m.snacks_cliente },
    { key:"combos_cliente", title:"Combo (sala)",   total:t.combos_cliente||0, pct:p.combos_cliente??0, mom:m.combos_cliente },
  ];

  const doughnutData = useMemo(() => ({
    labels:["Snack","Combo","Snack (Sala)","Combo (sala)"],
    datasets:[{ 
      data:[
        t.snacks_caja||0,
        t.combos_caja||0,
        t.snacks_cliente||0,
        t.combos_cliente||0
      ],
      backgroundColor: [
        COLORS.snacks_caja,
        COLORS.combos_caja,
        COLORS.snacks_cliente,
        COLORS.combos_cliente
      ],
      borderColor: '#ffffff',
      borderWidth: 3,
      hoverBackgroundColor: [
        COLORS_HOVER.snacks_caja,
        COLORS_HOVER.combos_caja,
        COLORS_HOVER.snacks_cliente,
        COLORS_HOVER.combos_cliente
      ],
      hoverBorderColor: '#ffffff',
      hoverBorderWidth: 4
    }]
  }), [t.snacks_caja, t.combos_caja, t.snacks_cliente, t.combos_cliente]);

  const barData = useMemo(() => ({
    labels:["Snack","Combo","Snack (Sala)","Combo (sala)"],
    datasets:[{ 
      label:"Ventas (GTQ)", 
      data:[
        t.snacks_caja||0,
        t.combos_caja||0,
        t.snacks_cliente||0,
        t.combos_cliente||0
      ],
      backgroundColor: [
        COLORS.snacks_caja,
        COLORS.combos_caja,
        COLORS.snacks_cliente,
        COLORS.combos_cliente
      ],
      borderColor: [
        COLORS.snacks_caja,
        COLORS.combos_caja,
        COLORS.snacks_cliente,
        COLORS.combos_cliente
      ],
      borderWidth: 1,
      hoverBackgroundColor: [
        COLORS_HOVER.snacks_caja,
        COLORS_HOVER.combos_caja,
        COLORS_HOVER.snacks_cliente,
        COLORS_HOVER.combos_cliente
      ],
      hoverBorderColor: [
        COLORS_HOVER.snacks_caja,
        COLORS_HOVER.combos_caja,
        COLORS_HOVER.snacks_cliente,
        COLORS_HOVER.combos_cliente
      ],
      hoverBorderWidth: 2,
      borderRadius: 8,
      barPercentage: 0.7,
      categoryPercentage: 0.8
    }]
  }), [t.snacks_caja, t.combos_caja, t.snacks_cliente, t.combos_cliente]);

  const monthText = useMemo(() => {
    if (!resp?.rango) return "";
    const [, m, y] = resp.rango.desde.split("/");
    const names=["Enero","Febrero","Marzo","Abril","Mayo","Junio","Julio","Agosto","Septiembre","Octubre","Noviembre","Diciembre"];
    return `${names[Number(m)-1]} ${y}`;
  }, [resp]);

  return (
    <div className="reporte-categorias">
      {/* Encabezado */}
      <div className="reporte-head">
        <h2>Reporte de Ventas por Categoría</h2>
        <div className="reporte-sub">{monthText ? `Período: ${monthText}` : "Período: —"}</div>
      </div>

      {/* Filtros */}
      <div className="rc-filtros">
        <input className="rc-input" name="desde" value={filtros.desde}
               onChange={onChange} placeholder="Desde (DD/MM/YYYY)" />
        <input className="rc-input" name="hasta" value={filtros.hasta}
               onChange={onChange} placeholder="Hasta (DD/MM/YYYY)" />
        <button className="rc-btn" onClick={fetchData} disabled={loading}>
          {loading ? "Cargando..." : "Aplicar"}
        </button>
        {err && <div className="rc-error">{err}</div>}
      </div>

      {/* Acciones */}
      <div className="rc-actions">
        <button className="rc-btn-export rc-btn-pdf" onClick={exportPDF} title="Exportar a PDF">
          <svg viewBox="0 0 24 24"><path d="M14 2H6a2 2 0 0 0-2 2v16a2 2 0 0 0 2 2h12a2 2 0 0 0 2-2V8z"/><path d="M14 2v6h6"/></svg>
          Exportar a PDF
        </button>
        <button className="rc-btn-export rc-btn-xls" onClick={exportExcel} title="Exportar a Excel">
          <svg viewBox="0 0 24 24"><path d="M3 3h18v2H3zM3 19h18v2H3zM7 8h3v8H7zM12 11h3v5h-3zM17 6h3v10h-3z"/></svg>
          Exportar a Excel
        </button>
      </div>

      {/* Cards */}
      <div className="rc-cards">
        {cards.map((c) => (
          <div key={c.key} className="rc-card">
            <div className="rc-kicker">{c.title}</div>
            <div className="rc-total">{fmtGTQ(c.total)}</div>
            <div className="rc-sub">{c.pct}% del total</div>
            <hr className="rc-hr" />
            <div className="rc-mom">
              Variación vs mes anterior:{" "}
              {c.mom === null || Number.isNaN(c.mom)
                ? <span className="rc-mom-null">—</span>
                : c.mom > 0
                  ? <span className="rc-mom-up">▲ {c.mom}%</span>
                  : c.mom < 0
                    ? <span className="rc-mom-down">▼ {Math.abs(c.mom)}%</span>
                    : <span className="rc-mom-null">0%</span>}
            </div>
          </div>
        ))}
      </div>

      {/* Gráficas */}
      <div className="rc-panels">
        <div className="rc-panel">
          <div className="rc-title">Participación por Categoría</div>
          <div className="rc-chart">
            <Doughnut
              data={doughnutData}
              options={{
                maintainAspectRatio:false,
                plugins:{ 
                  legend:{ 
                    position:"bottom",
                    labels: {
                      usePointStyle: true,
                      padding: 20,
                      font: {
                        size: 13,
                        weight: '500',
                        family: 'ui-sans-serif, system-ui'
                      },
                      color: '#374151'
                    }
                  }, 
                  tooltip:{ 
                    backgroundColor: 'rgba(255, 255, 255, 0.98)',
                    titleColor: '#1F2937',
                    bodyColor: '#374151',
                    borderColor: '#E5E7EB',
                    borderWidth: 1,
                    padding: 12,
                    callbacks:{ 
                      label:(context) => {
                        const label = context.label || '';
                        const value = context.parsed;
                        const total = context.dataset.data.reduce((a, b) => a + b, 0);
                        const percentage = total > 0 ? ((value / total) * 100).toFixed(1) : 0;
                        return `${label}: ${fmtGTQ(value)} (${percentage}%)`;
                      }
                    } 
                  }
                },
                cutout:"55%",
              }}
            />
          </div>
        </div>

        <div className="rc-panel">
          <div className="rc-title">Comparativa de Ventas</div>
          <div className="rc-chart">
            <Bar
              data={barData}
              options={{
                maintainAspectRatio:false,
                plugins:{ 
                  legend:{ display:false }, 
                  tooltip:{ 
                    backgroundColor: 'rgba(255, 255, 255, 0.98)',
                    titleColor: '#1F2937',
                    bodyColor: '#374151',
                    borderColor: '#E5E7EB',
                    borderWidth: 1,
                    padding: 12,
                    callbacks:{ 
                      label:(context)=>fmtGTQ(context.parsed.y) 
                    } 
                  }
                },
                scales:{
                  y:{ 
                    beginAtZero:true,
                    ticks:{ 
                      callback:(v)=>new Intl.NumberFormat("es-GT",{style:"currency",currency:"GTQ",maximumFractionDigits:0}).format(v),
                      font: {
                        size: 11,
                        weight: '500'
                      },
                      color: '#6B7280'
                    },
                    grid: {
                      color: 'rgba(0, 0, 0, 0.06)',
                      drawBorder: false
                    }
                  },
                  x: {
                    grid: {
                      display: false
                    },
                    ticks: {
                      font: {
                        size: 12,
                        weight: '500'
                      },
                      color: '#374151'
                    }
                  }
                }
              }}
            />
          </div>
        </div>
      </div>
    </div>
  );
}