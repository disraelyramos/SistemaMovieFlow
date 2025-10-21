// src/pages/ReportesVentasDeBoletos.jsx
import React, { useEffect, useMemo, useState } from "react";
import axios from "axios";
import { toast } from "react-toastify";
import "../styles/reportes-venta-boletos.css";

const API_BASE =
  import.meta.env?.VITE_API_BASE ||
  import.meta.env?.VITE_API_BASE_URL ||
  import.meta.env?.VITE_API_URL ||
  "http://localhost:3001";

/* ====== Utils ====== */
const money = (n) =>
  new Intl.NumberFormat("es-GT", { style: "currency", currency: "GTQ" })
    .format(Number(n || 0));

const intf = (n) =>
  new Intl.NumberFormat("es-GT", { maximumFractionDigits: 0 })
    .format(Number(n || 0));

/* Descarga un Blob como archivo */
const downloadBlob = (blob, filename) => {
  const url = URL.createObjectURL(blob);
  const a = document.createElement("a");
  a.href = url;
  a.download = filename;
  document.body.appendChild(a);
  a.click();
  a.remove();
  URL.revokeObjectURL(url);
};

const tsName = () => {
  const d = new Date();
  const z = (n) => String(n).padStart(2, "0");
  return `${d.getFullYear()}${z(d.getMonth() + 1)}${z(d.getDate())}_${z(d.getHours())}${z(d.getMinutes())}${z(d.getSeconds())}`;
};

const ReportesVentasDeBoletos = () => {
  // "" | TODOS | HOY | SEMANA | MES | PERSONALIZADO
  const [modo, setModo] = useState(""); // ← placeholder por defecto
  const [salaId, setSalaId] = useState("");
  const [desde, setDesde] = useState("");
  const [hasta, setHasta] = useState("");

  const [salas, setSalas] = useState([]);
  const [rows, setRows] = useState([]);
  const [loading, setLoading] = useState(false);

  /* ====== Cargar salas ====== */
  useEffect(() => {
    const fetchSalas = async () => {
      try {
        const { data } = await axios.get(`${API_BASE}/api/filtros/salas`);
        const raw = Array.isArray(data?.rows) ? data.rows : (Array.isArray(data) ? data : []);
        const list = raw
          .map((s) => ({
            id: s.id_sala ?? s.ID_SALA ?? s.id ?? s.ID ?? null,
            nombre: s.nombre ?? s.NOMBRE ?? s.name ?? s.NAME ?? "",
          }))
          .filter((s) => Number.isFinite(Number(s.id)) && String(s.nombre).trim() !== "");
        if (list.length === 0) toast.info("No hay salas para mostrar.");
        setSalas(list);
      } catch (e) {
        console.error("❌ Error /api/filtros/salas:", e);
        toast.error("No se pudieron cargar las salas.");
        setSalas([]);
      }
    };
    fetchSalas();
  }, []);

  const showRango = modo === "PERSONALIZADO";

  const queryParams = useMemo(() => {
    const p = { modo };
    const parsed = Number(salaId);
    if (Number.isFinite(parsed)) p.salaId = parsed;
    if (showRango) { p.desde = desde; p.hasta = hasta; }
    return p;
  }, [modo, salaId, desde, hasta, showRango]);

  const totalIngresos = useMemo(() => {
    return rows.reduce((acc, r) => acc + Number(r.TOTAL_INGRESOS ?? r.total_ingresos ?? r["TOTAL DE INGRESOS"] ?? 0), 0);
  }, [rows]);

  const validar = () => {
    const modoOk  = String(modo).trim() !== "";     // ← ahora también validamos el rango
    const salaOk  = String(salaId).trim() !== "";
    const desdeOk = !showRango || Boolean(desde);
    const hastaOk = !showRango || Boolean(hasta);
    if (!modoOk || !salaOk || !desdeOk || !hastaOk) {
      toast.warning("Completa los filtros requeridos.");
      return false;
    }
    return true;
  };

  const handleGenerar = async () => {
    if (!validar()) return;
    setLoading(true);
    try {
      const { data } = await axios.get(`${API_BASE}/api/reporte-venta-boletos`, { params: queryParams });
      if (data?.ok === false) {
        toast.error(data?.msg || "No se pudo obtener el reporte.");
        setRows([]); return;
      }
      setRows(Array.isArray(data?.rows) ? data.rows : []);
    } catch (e) {
      console.error(e);
      toast.error("Error al generar el reporte.");
      setRows([]);
    } finally {
      setLoading(false);
    }
  };

  /* ====== Descargar PDF real (sin toast de éxito) ====== */
  const handleImportarPDF = async () => {
    if (!rows.length) return toast.info("No hay datos para PDF.");
    const salaNombre = salas.find((s) => String(s.id) === String(salaId))?.nombre || "";
    const rangoLabel = rows?.[0]?.FECHA || rows?.[0]?.fecha || "";

    const filtros = {
      periodo: modo,
      salaNombre,
      rangoLabel,
      desde: showRango ? desde : null,
      hasta: showRango ? hasta : null,
    };

    try {
      const resp = await axios.post(
        `${API_BASE}/api/pdf/reporte-venta-boletos`,
        { filtros, rows, total: totalIngresos },
        { responseType: "blob" }
      );
      const blob = new Blob([resp.data], { type: "application/pdf" });
      const filename = `reporte_venta_boletos_${tsName()}.pdf`;
      downloadBlob(blob, filename);
      // ← sin toast.success
    } catch (e) {
      console.error(e);
      toast.error("No se pudo generar el PDF.");
    }
  };

  // Reemplaza tu handleImportarExcel por este:
const handleImportarExcel = async () => {
  if (!rows.length) return toast.info("No hay datos para Excel.");

  const salaNombre = salas.find((s) => String(s.id) === String(salaId))?.nombre || "";
  const rangoLabel = rows?.[0]?.FECHA || rows?.[0]?.fecha || "";
  const filtros = {
    periodo: modo,
    salaNombre,
    rangoLabel,
    desde: showRango ? desde : null,
    hasta: showRango ? hasta : null,
  };

  try {
    const resp = await axios.post(
      `${API_BASE}/api/excel/reporte-venta-boletos`,
      { filtros, rows, total: totalIngresos },
      { responseType: "blob" }
    );

    const blob = new Blob([resp.data], {
      type: "application/vnd.openxmlformats-officedocument.spreadsheetml.sheet",
    });
    const filename = `reporte_venta_boletos_${tsName()}.xlsx`;
    downloadBlob(blob, filename);
    // sin toast.success
  } catch (e) {
    console.error(e);
    toast.error("No se pudo generar el Excel.");
  }
};


  useEffect(() => {
    if (modo !== "PERSONALIZADO") { setDesde(""); setHasta(""); }
  }, [modo]);

  return (
    <div className="rvb-page">
      <h2 className="rvb-title">Reporte de Venta de Boletos</h2>

      {/* ====== Filtros ====== */}
      <div className="card rvb-card">
        <div className="card-body">
          <div className="row g-3 align-items-end">
            <div className="col-12 col-md-3">
              <label className="form-label rvb-label">Periodo</label>
              <select
                className="form-select"
                value={modo}
                onChange={(e) => setModo(e.target.value)}
              >
                <option value="">{/* placeholder */}Seleccione rango</option>
                <option value="TODOS">Todos</option>
                <option value="HOY">Hoy</option>
                <option value="SEMANA">Semana</option>
                <option value="MES">Mes</option>
                <option value="PERSONALIZADO">Personalizado</option>
              </select>
            </div>

            <div className="col-12 col-md-4">
              <label className="form-label rvb-label">Sala</label>
              <select
                className="form-select"
                value={salaId}
                onChange={(e) => setSalaId(e.target.value)}
              >
                <option value="">Selecciona una Sala</option>
                {salas.map((s) => (
                  <option key={s.id} value={String(s.id)}>
                    {s.nombre}
                  </option>
                ))}
              </select>
            </div>

            {showRango && (
              <>
                <div className="col-6 col-md-2">
                  <label className="form-label rvb-label">Desde</label>
                  <input
                    type="date"
                    className="form-control"
                    value={desde}
                    onChange={(e) => setDesde(e.target.value)}
                  />
                </div>
                <div className="col-6 col-md-2">
                  <label className="form-label rvb-label">Hasta</label>
                  <input
                    type="date"
                    className="form-control"
                    value={hasta}
                    onChange={(e) => setHasta(e.target.value)}
                  />
                </div>
              </>
            )}

            <div className="col-12 col-md-3 col-lg-3 d-flex align-items-end gap-2">
              <button
                className="btn btn-success flex-fill"
                onClick={handleGenerar}
                disabled={loading}
              >
                {loading ? "Generando..." : "Generar"}
              </button>

              <button
                className="btn btn-outline-dark"
                onClick={handleImportarPDF}
                disabled={loading}
                title="Importar PDF"
              >
                Importar PDF
              </button>

              <button
                className="btn btn-outline-primary"
                onClick={handleImportarExcel}
                disabled={loading}
                title="Importar Excel"
              >
                Importar Excel
              </button>
            </div>
          </div>
        </div>
      </div>

      {/* ====== Tabla ====== */}
      <div className="card rvb-card mt-3">
        <div className="card-body">
          <h5 className="mb-3">Resumen por Sala</h5>

          <div className="table-responsive">
            <table className="table rvb-table align-middle">
              <thead>
                <tr>
                  <th>Sala</th>
                  <th>Funciones</th>
                  <th>Capacidad</th>
                  <th>Boletos Vendidos</th>
                  <th>Total de Ingresos</th>
                  <th>Fecha</th>
                </tr>
              </thead>
              <tbody>
                {rows.length === 0 ? (
                  <tr>
                    <td colSpan="6" className="text-center text-muted py-4">
                      Sin datos para mostrar.
                    </td>
                  </tr>
                ) : (
                  rows.map((r) => (
                    <tr key={(r.ID_SALA ?? r.id_sala ?? r.SALA ?? r.sala) + (r.FECHA ?? r.fecha ?? "")}>
                      <td>{r.SALA ?? r.sala}</td>
                      <td>{intf(r.FUNCIONES ?? r.funciones)}</td>
                      <td>{intf(r.CAPACIDAD ?? r.capacidad)}</td>
                      <td>{intf(r.BOLETOS_VENDIDOS ?? r.boletos_vendidos)}</td>
                      <td>{money(r.TOTAL_INGRESOS ?? r.total_ingresos ?? r["TOTAL DE INGRESOS"] ?? 0)}</td>
                      <td>{r.FECHA ?? r.fecha ?? ""}</td>
                    </tr>
                  ))
                )}
              </tbody>

              <tfoot>
                <tr>
                  <th colSpan={4} className="text-end">Total</th>
                  <th>{money(totalIngresos)}</th>
                  <th />
                </tr>
              </tfoot>
            </table>
          </div>
        </div>
      </div>
    </div>
  );
};

export default ReportesVentasDeBoletos;
