// pdf/corteCaja.doc.js
const { sanitizeText } = require("../utils/pdfHelper");

const buildCorteCajaDoc = (negocio, corte, denominaciones) => {
  // Formato de denominación (billetes enteros, monedas con 2 decimales)
  const labelDenom = (v) => {
    const n = Number(v || 0);
    return n >= 1 ? `Q${Math.round(n)}` : `Q${n.toFixed(2)}`;
  };

  const filasDenominaciones = [
    [
      { text: "Denominación", bold: true },
      { text: "Cantidad", bold: true, alignment: "center" },
      { text: "Subtotal", bold: true, alignment: "right" }
    ]
  ];

  if (Array.isArray(denominaciones) && denominaciones.length > 0) {
    denominaciones.forEach((d) => {
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

  // --- Cálculos totales
  const totalContado  = Number(corte.TOTAL_CONTADO || corte.MONTO_CONTADO || 0);
  const montoEsperado = Number(corte.MONTO_ESPERADO || 0); // ya viene del backend
  const diferencia    = Number((totalContado - montoEsperado).toFixed(2));

  // Pagos de reservas (alias posibles)
  const totalPagosReservas = Number(
    corte.TOTAL_PAGOS_EVENTOS != null ? corte.TOTAL_PAGOS_EVENTOS
    : corte.TOTAL_PAGOS_RESERVAS != null ? corte.TOTAL_PAGOS_RESERVAS
    : 0
  );

  // Filas de totales
  const filasTotales = [
    [{ text: "MONTO APERTURA:", bold: true }, { text: `Q${Number(corte.MONTO_APERTURA || 0).toFixed(2)}`, alignment: "right" }],
    [{ text: "TOTAL VENTAS:",   bold: true }, { text: `Q${Number(corte.TOTAL_VENTAS   || 0).toFixed(2)}`, alignment: "right" }],
    [{ text: "PAGOS DE RESERVAS (EFECTIVO):", bold: true }, { text: `Q${totalPagosReservas.toFixed(2)}`, alignment: "right" }],
    [{ text: "MONTO ESPERADO:", bold: true }, { text: `Q${montoEsperado.toFixed(2)}`, alignment: "right" }],
    [{ text: "TOTAL CONTADO:",  bold: true }, { text: `Q${totalContado.toFixed(2)}`, alignment: "right" }],
  ];

  if (diferencia !== 0) {
    const etiqueta = diferencia > 0 ? "SOBRANTE:" : "FALTANTE:";
    filasTotales.push([
      { text: etiqueta, bold: true },
      { text: `Q${Math.abs(diferencia).toFixed(2)}`, alignment: "right" }
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

      { text: "CORTE / CIERRE DE CAJA", bold: true, alignment: "center", margin: [0, 5] },

      { columns: [{ text: "Caja:",   bold: true, width: 60 }, { text: sanitizeText(corte.CAJA)   }] },
      { columns: [{ text: "Cajero:", bold: true, width: 60 }, { text: sanitizeText(corte.CAJERO) }] },
      { columns: [{ text: "Fecha:",  bold: true, width: 60 }, { text: sanitizeText(corte.FECHA)  }] },
      { columns: [{ text: "Hora:",   bold: true, width: 60 }, { text: sanitizeText(corte.HORA)   }] },
      ...(corte.NUMERO_TICKET ? [
        { columns: [{ text: "Ticket:", bold: true, width: 60 }, { text: sanitizeText(corte.NUMERO_TICKET) }] }
      ] : []),

      { canvas: [{ type: "line", x1: 0, y1: 5, x2: 200, y2: 5, lineWidth: 1 }] },

      { text: "DENOMINACIONES:", bold: true, margin: [0, 5] },
      { table: { widths: ["*", 40, 60], body: filasDenominaciones }, layout: "noBorders" },

      { canvas: [{ type: "line", x1: 0, y1: 5, x2: 200, y2: 5, lineWidth: 1 }] },

      { table: { widths: ["*", "auto"], body: filasTotales }, layout: "noBorders", margin: [0, 5] },

      ...(corte.OBSERVACIONES
        ? [{ text: "Observaciones:", bold: true, margin: [0, 5, 0, 0] },
           { text: sanitizeText(corte.OBSERVACIONES), margin: [0, 0, 0, 5] }]
        : []),

      { text: "\n_______________________", alignment: "center" },
      { text: "Firma Cajero", alignment: "center", margin: [0, 0, 0, 6] },
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

module.exports = { buildCorteCajaDoc };
