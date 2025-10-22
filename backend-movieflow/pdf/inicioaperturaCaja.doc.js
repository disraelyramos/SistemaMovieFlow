// pdf/inicioaperturaCaja.doc.js
const { sanitizeText } = require("../utils/pdfHelper");

const buildAperturaCajaDoc = (negocio, apertura, denominaciones) => {
  // Helper: formato de denominación
  const labelDenom = (v) => {
    const n = Number(v || 0);
    return n >= 1 ? `Q${Math.round(n)}` : `Q${n.toFixed(2)}`;
  };

  // Fila cabecera de la tabla
  const filasDenominaciones = [
    [
      { text: "Denominación", bold: true },
      { text: "Cantidad", bold: true, alignment: "center" },
      { text: "Subtotal", bold: true, alignment: "right" }
    ]
  ];

  // Si hay denominaciones, agregarlas
  if (Array.isArray(denominaciones) && denominaciones.length > 0) {
    denominaciones.forEach((d) => {
      // Soporta distintos alias que puede enviar el query
      const valor = Number(d.DENOMINACION ?? d.VALOR ?? d.valor ?? 0);
      const cantidad = Number(d.CANTIDAD ?? d.cantidad ?? 0);
      const subtotal = Number(d.SUBTOTAL ?? d.subtotal ?? valor * cantidad);

      filasDenominaciones.push([
        labelDenom(valor),
        { text: `${cantidad}`, alignment: "center" },
        { text: `Q${subtotal.toFixed(2)}`, alignment: "right" }
      ]);
    });
  } else {
    filasDenominaciones.push([
      { text: "Sin denominaciones registradas", colSpan: 3, alignment: "center" },
      {},
      {}
    ]);
  }

  return {
    pageSize: { width: 226, height: "auto" },
    pageMargins: [10, 10, 10, 10],
    content: [
      { text: sanitizeText(negocio.NOMBRE_CINE || "CineFlow"), style: "header" },
      { text: sanitizeText(negocio.DIRECCION || ""), style: "subheader" },
      { text: `Tel: ${sanitizeText(negocio.TELEFONO || "")} | ${sanitizeText(negocio.CORREO || "")}`, style: "subheader" },
      { canvas: [{ type: "line", x1: 0, y1: 5, x2: 200, y2: 5, lineWidth: 1 }] },

      { text: "APERTURA DE CAJA", bold: true, alignment: "center", margin: [0, 5] },

      {
        columns: [
          { text: "Caja:", bold: true, width: 50 },
          { text: sanitizeText(apertura.CAJA) }
        ]
      },
      {
        columns: [
          { text: "Turno:", bold: true, width: 50 },
          { text: sanitizeText(apertura.TURNO) }
        ]
      },
      {
        columns: [
          { text: "Cajero:", bold: true, width: 50 },
          { text: sanitizeText(apertura.CAJERO) }
        ]
      },
      {
        columns: [
          { text: "Fecha:", bold: true, width: 50 },
          { text: sanitizeText(apertura.FECHA) }
        ]
      },
      {
        columns: [
          { text: "Hora:", bold: true, width: 50 },
          { text: sanitizeText(apertura.HORA) }
        ]
      },
      {
        columns: [
          { text: "Ticket:", bold: true, width: 50 },
          { text: sanitizeText(apertura.NUMERO_TICKET) }
        ]
      },

      { canvas: [{ type: "line", x1: 0, y1: 5, x2: 200, y2: 5, lineWidth: 1 }] },

      { text: "DENOMINACIONES:", bold: true, margin: [0, 5] },
      {
        table: {
          widths: ["*", 40, 60],
          body: filasDenominaciones
        },
        layout: "noBorders"
      },

      { canvas: [{ type: "line", x1: 0, y1: 5, x2: 200, y2: 5, lineWidth: 1 }] },

      {
        table: {
          widths: ["*", "auto"],
          body: [
            [
              { text: "TOTAL EFECTIVO INICIAL:", bold: true },
              {
                text: `Q${Number(apertura.TOTAL_EFECTIVO_INICIAL || 0).toFixed(2)}`,
                bold: true,
                alignment: "right"
              }
            ]
          ]
        },
        layout: "noBorders",
        margin: [0, 5]
      },

      ...(apertura.OBSERVACIONES
        ? [
            { text: "Observaciones:", bold: true, margin: [0, 5, 0, 0] },
            { text: sanitizeText(apertura.OBSERVACIONES), margin: [0, 0, 0, 5] }
          ]
        : []),

      { text: "\n\n_______________________", alignment: "center" },
      { text: "Firma Cajero", alignment: "center", margin: [0, 0, 0, 10] },
      { text: "_______________________", alignment: "center" },
      { text: "Firma Supervisor", alignment: "center", margin: [0, 0, 0, 10] },

      { text: "Sistema POS v2.1", style: "footer" },
      { text: "www.comercialguatemala.com", style: "footer" },
      { text: "Conserve este comprobante", style: "footer" }
    ],
    styles: {
      header: { fontSize: 12, bold: true, alignment: "center" },
      subheader: { fontSize: 8, alignment: "center" },
      footer: { fontSize: 8, alignment: "center" }
    },
    defaultStyle: { font: "Roboto", fontSize: 8 }
  };
};

module.exports = { buildAperturaCajaDoc };
