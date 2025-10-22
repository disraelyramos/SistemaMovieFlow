// pdf/reporteVentaBoletos.doc.js
const { sanitizeText } = require("../utils/pdfHelper");

const fmtQ = (n) => `Q${Number(n || 0).toFixed(2)}`;
const intf = (n) => Number(n || 0).toLocaleString("es-GT");

/* Bloque tipo etiqueta:valor */
function labelVal(label, val) {
  return {
    columns: [
      { text: `${label}:`, bold: true, width: 130 },
      { text: sanitizeText(val || "-") }
    ],
    margin: [0, 1, 0, 1]
  };
}

/* Filtros sin encabezado adicional (mismo estilo que el otro PDF) */
function filtrosBlock(f) {
  const out = [];
  if (f?.periodo) out.push(labelVal("Periodo", f.periodo));
  if (f?.salaNombre) out.push(labelVal("Sala", f.salaNombre));
  if (f?.rangoLabel) out.push(labelVal("Rango", f.rangoLabel));
  if (f?.periodo === "PERSONALIZADO" && (f.desde || f.hasta)) {
    out.push(labelVal("Fecha Desde", f.desde || ""));
    out.push(labelVal("Fecha Hasta", f.hasta || ""));
  }
  return out;
}

/* Tabla principal: por sala */
function buildTable(rows) {
  const headers = [
    { text: "Sala", bold: true },
    { text: "Funciones", bold: true, alignment: "right" },
    { text: "Capacidad", bold: true, alignment: "right" },
    { text: "Boletos Vendidos", bold: true, alignment: "right" },
    { text: "Total Ingresos (Q)", bold: true, alignment: "right" },
    { text: "Fecha", bold: true, alignment: "center" },
  ];

  const body = [headers];

  (rows || []).forEach((r) => {
    body.push([
      sanitizeText(r.sala),
      { text: intf(r.funciones), alignment: "right" },
      { text: intf(r.capacidad), alignment: "right" },
      { text: intf(r.boletos_vendidos), alignment: "right" },
      { text: fmtQ(r.total_ingresos), alignment: "right" },
      { text: sanitizeText(r.fecha || ""), alignment: "center" },
    ]);
  });

  return {
    table: {
      headerRows: 1,
      widths: ["*", 70, 75, 95, 115, 95],
      body
    },
    layout: "lightHorizontalLines",
    margin: [0, 6, 0, 0]
  };
}

const buildReporteVentaBoletosDoc = (negocio = {}, payload = {}) => {
  const {
    nowFecha = "",
    nowHora  = "",
    filtros  = {},
    rows     = [],
    total    = 0
  } = payload;

  return {
    pageSize: "LETTER",
    pageMargins: [32, 36, 32, 40],
    defaultStyle: { font: "Roboto", fontSize: 9 },
    styles: {
      headTitle: { fontSize: 14, bold: true, alignment: "center", margin: [0, 2, 0, 2] },
      business:  { fontSize: 10, alignment: "center" },
      small:     { fontSize: 8, color: "#666" },
      totalRow:  { bold: true }
    },
    footer: (currentPage, pageCount) => ({
      columns: [
        { text: `Página ${currentPage} de ${pageCount}`, style: "small" },
        { text: "Sistema POS v2.1", alignment: "right", style: "small" }
      ],
      margin: [32, 10, 32, 0]
    }),
    content: [
      // Cabecera negocio
      { text: sanitizeText(negocio.NOMBRE_CINE || "Comercial Guatemala"), style: "headTitle" },
      { text: sanitizeText(negocio.DIRECCION || ""), style: "business" },
      { text: `Tel: ${sanitizeText(negocio.TELEFONO || "")}  •  ${sanitizeText(negocio.CORREO || "")}`, style: "business", margin: [0, 0, 0, 6] },

      // Título + fecha/hora
      { text: "REPORTE DE VENTA DE BOLETOS POR SALA", style: "headTitle", margin: [0, 2, 0, 6] },
      {
        columns: [
          { text: `Fecha generación: ${nowFecha}`, style: "small" },
          { text: `Hora: ${nowHora}`, alignment: "right", style: "small" }
        ],
        margin: [0, 0, 0, 6]
      },

      // Filtros
      ...filtrosBlock(filtros),

      // Tabla
      buildTable(rows),

      // Total general (suma de ingresos)
      {
        table: {
          widths: ["*", 140],
          body: [[
            { text: "Total general de ingresos", style: "totalRow", alignment: "right" },
            { text: fmtQ(total), style: "totalRow", alignment: "right" }
          ]]
        },
        layout: "noBorders",
        margin: [0, 8, 0, 0]
      }
    ]
  };
};

module.exports = { buildReporteVentaBoletosDoc };
