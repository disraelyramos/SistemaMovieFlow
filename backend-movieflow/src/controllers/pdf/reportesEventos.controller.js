// controllers/pdf/reportesEventos.controller.js
const db = require("../../config/db");
const oracledb = require("oracledb");
const { sendPDF } = require("../../../utils/pdfHelper");
const { buildReportesEventosDoc } = require("../../../pdf/Reportes_Eventos.doc");

const z = (n) => String(n).padStart(2, "0");
const fmtFecha = (d) => `${z(d.getDate())}/${z(d.getMonth() + 1)}/${d.getFullYear()}`;
const fmtHora  = (d) => `${z(d.getHours())}:${z(d.getMinutes())}:${z(d.getSeconds())}`;
const yyyymmdd_hhmmss = (d) =>
  `${d.getFullYear()}${z(d.getMonth()+1)}${z(d.getDate())}_${z(d.getHours())}${z(d.getMinutes())}${z(d.getSeconds())}`;

exports.generarReporteEventosPDF = async (req, res) => {
  let cn;
  try {
    const { filtros = {}, kpis = {}, detalle = [], charts = {} } = req.body || {};
    if (!Array.isArray(detalle)) {
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
    const negocio = rsNeg.rows?.[0] || { NOMBRE_CINE: "Mi Cine", DIRECCION: "", TELEFONO: "", CORREO: "" };

    const now = new Date();
    const payload = {
      nowFecha: fmtFecha(now),
      nowHora: fmtHora(now),
      filtros,
      kpis,
      detalle,
      charts,
    };

    const doc = buildReportesEventosDoc(negocio, payload);
    const fname = `reportes_eventos_${yyyymmdd_hhmmss(now)}.pdf`;
    sendPDF(res, doc, fname);
  } catch (err) {
    console.error("❌ Error generarReporteEventosPDF:", err);
    res.status(500).json({ message: "Error al generar PDF." });
  } finally {
    try { await cn?.close(); } catch {}
  }
};
