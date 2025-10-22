// backend-movieflow/src/controllers/pdf/reporteVentaBoletos.controller.js
const db = require("../../config/db");
const oracledb = require("oracledb");

// utils y doc (misma ubicación relativa que el otro PDF)
const { sendPDF, sanitizeText } = require("../../../utils/pdfHelper");
const { buildReporteVentaBoletosDoc } = require("../../../pdf/reporteVentaBoletos.doc");

// ===== utilidades de fecha/hora =====
const z = (n) => String(n).padStart(2, "0");
const fmtFecha = (d) => `${z(d.getDate())}/${z(d.getMonth() + 1)}/${d.getFullYear()}`;
const fmtHora  = (d) => `${z(d.getHours())}:${z(d.getMinutes())}:${z(d.getSeconds())}`; // 24h
const yyyymmdd_hhmmss = (d) => `${d.getFullYear()}${z(d.getMonth() + 1)}${z(d.getDate())}_${z(d.getHours())}${z(d.getMinutes())}${z(d.getSeconds())}`;

exports.generarReporteVentaBoletosPDF = async (req, res) => {
  let cn;
  try {
    const { filtros = {}, rows, total } = req.body || {};
    if (!Array.isArray(rows) || rows.length === 0) {
      return res.status(400).json({ message: "No hay filas para exportar." });
    }

    // Normalizar filtros que usa la vista (periodo/sala/rango)
    const F = {
      // puede venir como 'TODOS' | 'HOY' | 'SEMANA' | 'MES' | 'PERSONALIZADO' (del front)
      periodo: (filtros.periodo || filtros.modo || "").toString().toUpperCase(),
      salaNombre: filtros.salaNombre || filtros.sala || "",
      rangoLabel: filtros.rangoLabel || filtros.rango_label || filtros.fecha || "",

      // compatibles si usaste personalizado en el front
      desde: filtros.desde || null,
      hasta: filtros.hasta || null,

      // sello de generación (opcional desde el front)
      generadoEn: filtros.generadoEn || new Date().toISOString(),
    };

    // Mapeo seguro de filas del reporte de boletos
    // Esperado desde el endpoint: sala, funciones, capacidad, boletos_vendidos, total_ingresos, fecha
    const safeRows = rows.map((r) => ({
      sala: sanitizeText(r.SALA ?? r.sala ?? ""),
      funciones: Number(r.FUNCIONES ?? r.funciones ?? 0),
      capacidad: Number(r.CAPACIDAD ?? r.capacidad ?? 0),
      boletos_vendidos: Number(r.BOLETOS_VENDIDOS ?? r.boletos_vendidos ?? 0),
      total_ingresos: Number(r.TOTAL_INGRESOS ?? r.total_ingresos ?? r["TOTAL DE INGRESOS"] ?? 0),
      fecha: sanitizeText(r.FECHA ?? r.fecha ?? ""),
    }));

    // Total general (si no viene calculado)
    const totalGeneral = Number.isFinite(Number(total))
      ? Number(total)
      : safeRows.reduce((acc, r) => acc + Number(r.total_ingresos || 0), 0);

    cn = await db.getConnection();

    // Datos del negocio (mismo query que el otro PDF)
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
      nowHora:  fmtHora(now), // 24h
      filtros: F,
      rows: safeRows,
      total: totalGeneral,
    };

    const doc = buildReporteVentaBoletosDoc(negocio, payload);
    const fname = `reporte_venta_boletos_${yyyymmdd_hhmmss(now)}.pdf`;
    sendPDF(res, doc, fname);
  } catch (err) {
    console.error("❌ Error generarReporteVentaBoletosPDF:", err);
    return res.status(500).json({ message: "Error al generar PDF." });
  } finally {
    if (cn) { try { await cn.close(); } catch {} }
  }
};
