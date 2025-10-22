// backend-movieflow/src/controllers/pdf/ventasCategoria.controller.js
const db = require("../../config/db");
const oracledb = require("oracledb");
const { sendPDF } = require("../../../utils/pdfHelper");
const { buildReporteVentasCategoriaDoc } = require("../../../pdf/Reporte_Ventas_Categoria.doc");

const z = (n) => String(n).padStart(2, "0");
const fmtFecha = (d) => `${z(d.getDate())}/${z(d.getMonth() + 1)}/${d.getFullYear()}`;
const fmtHora  = (d) => `${z(d.getHours())}:${z(d.getMinutes())}:${z(d.getSeconds())}`;
const yyyymmdd_hhmmss = (d) =>
  `${d.getFullYear()}${z(d.getMonth()+1)}${z(d.getDate())}_${z(d.getHours())}${z(d.getMinutes())}${z(d.getSeconds())}`;

exports.generarReporteVentasCategoriaPDF = async (req, res) => {
  let cn;
  try {
    // Esperamos un body al estilo ReportesEventos:
    // {
    //   filtros: { desde, hasta },
    //   resumen: {
    //     totales: { snacks_caja, combos_caja, snacks_cliente },
    //     participacion: { snacks_caja, combos_caja, snacks_cliente },
    //     variacion_mom: { snacks_caja, combos_caja, snacks_cliente }
    //   },
    //   charts: { imgPie, imgBar } // opcional base64
    // }
    const { filtros = {}, resumen = {}, charts = {} } = req.body || {};
    if (!resumen || typeof resumen !== "object") {
      return res.status(400).json({ message: "No hay datos para exportar." });
    }

    cn = await db.getConnection();
    const rsNeg = await cn.execute(
      `SELECT NOMBRE_CINE, DIRECCION, TELEFONO, CORREO
         FROM POS_CONFIGURACION_NEGOCIO
        WHERE ROWNUM = 1`,
      [],
      { outFormat: oracledb.OUT_FORMAT_OBJECT }
    );
    const negocio = rsNeg.rows?.[0] || {
      NOMBRE_CINE: "Mi Cine",
      DIRECCION: "",
      TELEFONO: "",
      CORREO: ""
    };

    const now = new Date();
    const payload = {
      nowFecha: fmtFecha(now),
      nowHora: fmtHora(now),
      filtros,
      resumen,
      charts
    };

    const doc = buildReporteVentasCategoriaDoc(negocio, payload);
    const fname = `reporte_ventas_categoria_${yyyymmdd_hhmmss(now)}.pdf`;
    sendPDF(res, doc, fname);

  } catch (err) {
    console.error("❌ Error generarReporteVentasCategoriaPDF:", err);
    res.status(500).json({ message: "Error al generar PDF." });
  } finally {
    try { await cn?.close(); } catch {}
  }
};
