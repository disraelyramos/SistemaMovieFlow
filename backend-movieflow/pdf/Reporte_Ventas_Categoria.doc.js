// backend-movieflow/pdf/Reporte_Ventas_Categoria.doc.js
const { sanitizeText } = require("../utils/pdfHelper");

const fmtQ = (n) => `Q ${Number(n || 0).toFixed(2)}`;

function kpiCards(resumen = {}) {
  const t = resumen.totales || {};
  const p = resumen.participacion || {};
  const m = resumen.variacion_mom || {};

  const items = [
    { title: "Snacks (Caja)",    total: t.snacks_caja,    part: p.snacks_caja,    mom: m.snacks_caja },
    { title: "Combos (Caja)",    total: t.combos_caja,    part: p.combos_caja,    mom: m.combos_caja },
    { title: "Snacks (Cliente)", total: t.snacks_cliente, part: p.snacks_cliente, mom: m.snacks_cliente },
  ];

  const toVarTxt = (v) => (v === null || Number.isNaN(v)) ? "—" :
    (v > 0 ? `▲ ${v}%` : v < 0 ? `▼ ${Math.abs(v)}%` : "0%");

  return {
    columns: items.map(it => ({
      width: "33.33%",
      stack: [
        { text: it.title, bold: true, margin: [0, 0, 0, 2] },
        { text: fmtQ(it.total), fontSize: 12, bold: true },
        { text: `${Number(it.part || 0).toFixed(1)}% del total`, color: "#555" },
        { canvas: [{ type: "line", x1: 0, y1: 8, x2: 160, y2: 8, lineWidth: 0.5, lineColor: "#ddd" }] },
        { text: `Variación vs mes anterior: ${toVarTxt(it.mom)}`, margin: [0, 4, 0, 0] },
      ],
      margin: [0, 2, 8, 2],
    })),
    margin: [0, 4, 0, 8]
  };
}

function tablaResumen(resumen = {}) {
  const t = resumen.totales || {};
  const p = resumen.participacion || {};
  const m = resumen.variacion_mom || {};

  const rows = [
    ["Snacks (Caja)",    t.snacks_caja,    p.snacks_caja,    m.snacks_caja],
    ["Combos (Caja)",    t.combos_caja,    p.combos_caja,    m.combos_caja],
    ["Snacks (Cliente)", t.snacks_cliente, p.snacks_cliente, m.snacks_cliente],
  ];
  const total = rows.reduce((acc, r) => acc + Number(r[1] || 0), 0);

  const body = [[
    { text: "Categoría", bold: true },
    { text: "Total (Q)", bold: true, alignment: "right" },
    { text: "Participación %", bold: true, alignment: "right" },
    { text: "Var. vs mes ant. %", bold: true, alignment: "right" },
  ]];

  rows.forEach(r => {
    body.push([
      r[0],
      { text: Number(r[1] || 0).toFixed(2), alignment: "right" },
      { text: `${Number(r[2] || 0).toFixed(1)}%`, alignment: "right" },
      { text: (r[3] === null || Number.isNaN(r[3])) ? "—" : `${Number(r[3]).toFixed(1)}%`, alignment: "right" },
    ]);
  });

  body.push([
    { text: "TOTAL", bold: true },
    { text: Number(total).toFixed(2), alignment: "right", bold: true },
    { text: "", colSpan: 2 }, {}
  ]);

  return {
    table: { headerRows: 1, widths: ["*", 60, 70, 90], body },
    layout: "lightHorizontalLines",
    margin: [0, 6, 0, 4],
  };
}

const buildReporteVentasCategoriaDoc = (negocio = {}, payload = {}) => {
  const {
    nowFecha = "",
    nowHora = "",
    filtros = {},
    resumen = {},
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
      sectionTitle: { bold: true, margin: [0, 6, 0, 4] },
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

      { text: "REPORTE DE VENTAS POR CATEGORÍA", style: "headTitle", margin: [0, 2, 0, 6] },
      {
        columns: [
          { text: `Fecha generación: ${nowFecha}`, style: "small" },
          { text: `Hora: ${nowHora}`, alignment: "right", style: "small" },
        ],
        margin: [0, 0, 0, 6],
      },

      // Filtros
      { text: "Filtros", style: "sectionTitle" },
      {
        stack: [
          { columns: [{ text: "Rango:", bold: true, width: 80 }, { text: sanitizeText(`${filtros.desde || "-"} a ${filtros.hasta || "-"}`) }] },
        ],
        margin: [0, 0, 0, 4],
      },

      // KPI cards (totales + participación + variación)
      kpiCards(resumen),

      // Gráficas (si llegan desde el front)
      ...(charts?.imgPie ? [
        { text: "Participación por Categoría (Gráfica)", style: "sectionTitle" },
        { image: charts.imgPie, width: 460, margin: [0, 0, 0, 8] },
      ] : []),
      ...(charts?.imgBar ? [
        { text: "Comparativa de Ventas (Gráfica)", style: "sectionTitle" },
        { image: charts.imgBar, width: 460, margin: [0, 0, 0, 8] },
      ] : []),

      // Tabla Resumen
      { text: "Detalle Resumen", style: "sectionTitle" },
      tablaResumen(resumen),
    ],
  };
};

module.exports = { buildReporteVentasCategoriaDoc };
