// pdf/Reportes_Eventos.doc.js
const { sanitizeText } = require("../utils/pdfHelper");
const z = (n) => String(n).padStart(2, "0");

const fmtQ = (n) => `Q${Number(n || 0).toFixed(2)}`;

function labelVal(label, val, w = 140) {
  return {
    columns: [
      { text: `${label}:`, bold: true, width: w },
      { text: sanitizeText(val ?? "-") },
    ],
    margin: [0, 1, 0, 1],
  };
}

/* === Bloque filtros: rango, sala, estado, cliente === */
function filtrosBlock(f = {}) {
  const out = [];
  const rango =
    (f.desde || f.hasta)
      ? `${f.desde || "-"}  a  ${f.hasta || "-"}`
      : null;

  if (rango) out.push(labelVal("Rango", rango));
  if (f.salaNombre || f.salaId) out.push(labelVal("Sala", f.salaNombre || f.salaId));
  if (f.estado) out.push(labelVal("Estado", f.estado));
  if (f.cliente) out.push(labelVal("Cliente", f.cliente));
  return out;
}

/* === KPIs en texto === */
function kpiList(k = {}) {
  return {
    margin: [0, 6, 0, 8],
    stack: [
      { text: `Tasa de Ocupación: ${Number(k.ocupacion || 0).toFixed(0)}%` },
      { text: `Ingresos del Período: ${fmtQ(k.ingresosMes)}` },
      { text: `Reservas Totales: ${Number(k.reservasTotales || 0).toLocaleString()}` },
      { text: `Ticket Promedio: ${fmtQ(k.ticketPromedio)}` },
    ],
  };
}

/* === Tabla Detalle === */
function tableDetalle(rows = []) {
  const body = [[
    { text: "Fecha/Hora", bold: true },
    { text: "Sala", bold: true },
    { text: "Estado", bold: true },
    { text: "Cliente", bold: true },
    { text: "Personas", bold: true, alignment: "right" },
    { text: "Monto (Q)", bold: true, alignment: "right" },
    { text: "Notas", bold: true },
  ]];

  rows.forEach((r) => {
    body.push([
      sanitizeText(r.fecha || ""),
      sanitizeText(r.sala || ""),
      sanitizeText(r.estado || ""),
      sanitizeText(r.cliente || ""),
      { text: Number(r.personas || 0).toLocaleString(), alignment: "right" },
      { text: Number(r.monto || 0).toFixed(2), alignment: "right" },
      sanitizeText(r.notas || ""),
    ]);
  });

  return {
    table: { headerRows: 1, widths: [80, 60, 60, "*", 40, 60, "*"], body },
    layout: "lightHorizontalLines",
    margin: [0, 4, 0, 0],
  };
}

const buildReportesEventosDoc = (negocio = {}, payload = {}) => {
  const {
    nowFecha = "",
    nowHora = "",
    filtros = {},
    kpis = {},
    detalle = [],
    charts = {},
  } = payload;

  return {
    pageSize: "LETTER",
    pageMargins: [32, 36, 32, 40],
    defaultStyle: { font: "Roboto", fontSize: 9 },
    styles: {
      headTitle: { fontSize: 14, bold: true, alignment: "center", margin: [0, 2, 0, 2] },
      business: { fontSize: 10, alignment: "center" },
      small: { fontSize: 8, color: "#666" },
    },
    footer: (currentPage, pageCount) => ({
      columns: [
        { text: `Página ${currentPage} de ${pageCount}`, style: "small" },
        { text: "Sistema POS v2.1", alignment: "right", style: "small" },
      ],
      margin: [32, 10, 32, 0],
    }),
    content: [
      { text: sanitizeText(negocio.NOMBRE_CINE || "Comercial Guatemala"), style: "headTitle" },
      { text: sanitizeText(negocio.DIRECCION || ""), style: "business" },
      { text: `Tel: ${sanitizeText(negocio.TELEFONO || "")}  •  ${sanitizeText(negocio.CORREO || "")}`, style: "business", margin: [0, 0, 0, 6] },

      { text: "REPORTE DE EVENTOS", style: "headTitle", margin: [0, 2, 0, 6] },
      {
        columns: [
          { text: `Fecha generación: ${nowFecha}`, style: "small" },
          { text: `Hora: ${nowHora}`, alignment: "right", style: "small" },
        ],
        margin: [0, 0, 0, 6],
      },

      // Filtros
      ...filtrosBlock(filtros),

      // KPIs
      kpiList(kpis),

      // Gráficas si llegan (capturadas desde el front)
      ...(charts?.imgDias
        ? [
            { text: "Días con Mayor Demanda (Gráfica)", bold: true, margin: [0, 4, 0, 4] },
            { image: charts.imgDias, width: 500, margin: [0, 0, 0, 8] },
          ]
        : []),
      ...(charts?.imgHoras
        ? [
            { text: "Horarios Más Solicitados (Gráfica)", bold: true, margin: [0, 4, 0, 4] },
            { image: charts.imgHoras, width: 500, margin: [0, 0, 0, 8] },
          ]
        : []),
      ...(charts?.imgSemanas
        ? [
            { text: "Ingresos por Semana (Gráfica)", bold: true, margin: [0, 4, 0, 4] },
            { image: charts.imgSemanas, width: 500, margin: [0, 0, 0, 8] },
          ]
        : []),

      // Detalle
      { text: "Detalle de Eventos", bold: true, margin: [0, 2, 0, 4] },
      tableDetalle(detalle),
    ],
  };
};

module.exports = { buildReportesEventosDoc };
