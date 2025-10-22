// controllers/excel/reportesEventos.controller.js
const db = require("../../config/db");
const oracledb = require("oracledb");
const ExcelJS = require("exceljs");

/* ====== Utils ====== */
const z = (n) => String(n).padStart(2, "0");
const fmtFecha = (d) => `${z(d.getDate())}/${z(d.getMonth() + 1)}/${d.getFullYear()}`;
const fmtHora  = (d) => `${z(d.getHours())}:${z(d.getMinutes())}:${z(d.getSeconds())}`;
const yyyymmdd_hhmmss = (d) =>
  `${d.getFullYear()}${z(d.getMonth()+1)}${z(d.getDate())}_${z(d.getHours())}${z(d.getMinutes())}${z(d.getSeconds())}`;

/** Quita el prefijo "data:image/png;base64," si viene */
function normalizeBase64Image(b64 = "") {
  if (typeof b64 !== "string") return null;
  const idx = b64.indexOf("base64,");
  return idx >= 0 ? b64.slice(idx + 7) : b64;
}

exports.generarReportesEventosExcel = async (req, res) => {
  let cn;
  try {
    const {
      filtros = {},     // { desde, hasta, salaId, salaNombre, estado, cliente }
      kpis = {},        // { ocupacion, ingresosMes, reservasTotales, ticketPromedio }
      detalle = [],     // filas planas ya filtradas desde el front (mapRowToExport)
      charts = {},      // { imgDias, imgHoras, imgSemanas } base64 (opcional)
    } = req.body || {};

    if (!Array.isArray(detalle)) {
      return res.status(400).json({ message: "No hay datos para exportar." });
    }

    cn = await db.getConnection();

    // Datos del negocio
    const rsNeg = await cn.execute(
      `SELECT NOMBRE_CINE, DIRECCION, TELEFONO, CORREO
         FROM POS_CONFIGURACION_NEGOCIO
        WHERE ROWNUM = 1`,
      [],
      { outFormat: oracledb.OUT_FORMAT_OBJECT }
    );
    const negocio = rsNeg.rows?.[0] || {};

    /* ====== Workbook ====== */
    const wb = new ExcelJS.Workbook();

    /* ======================= Hoja: Resumen ======================= */
    const ws = wb.addWorksheet("Resumen", { properties: { defaultRowHeight: 18 } });

    // Columnas (A–J) pensadas para el layout
    ws.columns = [
      { key: "A", width: 22 },
      { key: "B", width: 22 },
      { key: "C", width: 10 },
      { key: "D", width: 16 },
      { key: "E", width: 16 },
      { key: "F", width: 16 },
      { key: "G", width: 16 },
      { key: "H", width: 16 },
      { key: "I", width: 16 },
      { key: "J", width: 16 },
    ];

    // Encabezado negocio
    ws.mergeCells("A1:J1");
    ws.getCell("A1").value = negocio.NOMBRE_CINE || "CineFlow";
    ws.getCell("A1").font = { bold: true, size: 16 };
    ws.getCell("A1").alignment = { horizontal: "center" };

    ws.mergeCells("A2:J2");
    const linea2 = [
      negocio.DIRECCION || "",
      negocio.TELEFONO ? `Tel: ${negocio.TELEFONO}` : "",
      negocio.CORREO ? `•  ${negocio.CORREO}` : ""
    ].filter(Boolean).join("   •   ");
    ws.getCell("A2").value = linea2;
    ws.getCell("A2").alignment = { horizontal: "center" };

    // Título general
    ws.mergeCells("A4:J4");
    ws.getCell("A4").value = "REPORTE DE EVENTOS";
    ws.getCell("A4").font = { bold: true, size: 14 };
    ws.getCell("A4").alignment = { horizontal: "center" };

    const now = new Date();
    ws.getCell("A5").value = `Fecha generación: ${fmtFecha(now)}`;
    ws.getCell("J5").value = `Hora: ${fmtHora(now)}`;
    ws.getCell("J5").alignment = { horizontal: "right" };

    // ==== Filtros (rango, sala, estado, cliente) ====
    let row = 7;
    ws.getCell(`A${row}`).value = "Filtros";
    ws.getCell(`A${row}`).font  = { bold: true, size: 12 };
    row++;

    const putLblVal = (lbl, val) => {
      ws.getCell(`A${row}`).value = lbl;
      ws.getCell(`A${row}`).font = { bold: true };
      ws.getCell(`B${row}`).value = val ?? "-";
      row++;
    };

    const rango = (filtros.desde || filtros.hasta)
      ? `${filtros.desde || "-"}  a  ${filtros.hasta || "-"}`
      : "-";

    putLblVal("Rango:", rango);
    if (filtros.salaNombre || filtros.salaId) {
      putLblVal("Sala:", filtros.salaNombre || filtros.salaId || "-");
    }
    if (filtros.estado) {
      putLblVal("Estado:", filtros.estado);
    }
    if (filtros.cliente) {
      putLblVal("Cliente:", filtros.cliente);
    }

    row++; // espacio

    // ==== KPIs ====
    ws.getCell(`A${row}`).value = "KPIs";
    ws.getCell(`A${row}`).font  = { bold: true, size: 12 };
    row++;

    const putKpi = (label, value, cellFmt) => {
      ws.getCell(`A${row}`).value = label;
      ws.getCell(`A${row}`).font = { bold: true };
      ws.getCell(`B${row}`).value = value;
      if (cellFmt) ws.getCell(`B${row}`).numFmt = cellFmt;
      row++;
    };

    putKpi("Tasa de Ocupación:", Number(kpis.ocupacion || 0) / 100, "0%");
    putKpi("Ingresos del Período:", Number(kpis.ingresosMes || 0), '#,##0.00');
    putKpi("Reservas Totales:", Number(kpis.reservasTotales || 0), '#,##0');
    putKpi("Ticket Promedio:", Number(kpis.ticketPromedio || 0), '#,##0.00');

    row++; // espacio

    // ==== Títulos de gráficas ====
    ws.mergeCells(`A${row}:E${row}`);
    ws.getCell(`A${row}`).value = "Días con Mayor Demanda";
    ws.getCell(`A${row}`).font = { bold: true };
    ws.mergeCells(`F${row}:J${row}`);
    ws.getCell(`F${row}`).value = "Horarios Más Solicitados";
    ws.getCell(`F${row}`).font = { bold: true };
    row++;

    // ==== Imágenes (si vienen) ====
    const imgDias = normalizeBase64Image(charts.imgDias);
    const imgHoras = normalizeBase64Image(charts.imgHoras);
    const imgSemanas = normalizeBase64Image(charts.imgSemanas);

    if (imgDias) {
      const id = wb.addImage({ base64: imgDias, extension: "png" });
      ws.mergeCells(`A${row}:E${row + 16}`);
      ws.addImage(id, `A${row}:E${row + 16}`);
    }
    if (imgHoras) {
      const id = wb.addImage({ base64: imgHoras, extension: "png" });
      ws.mergeCells(`F${row}:J${row + 16}`);
      ws.addImage(id, `F${row}:J${row + 16}`);
    }
    row += 18;

    ws.mergeCells(`A${row}:J${row}`);
    ws.getCell(`A${row}`).value = "Ingresos por Semana";
    ws.getCell(`A${row}`).font = { bold: true };
    row++;

    if (imgSemanas) {
      const id = wb.addImage({ base64: imgSemanas, extension: "png" });
      ws.mergeCells(`A${row}:J${row + 16}`);
      ws.addImage(id, `A${row}:J${row + 16}`);
      row += 18;
    }

    /* ======================= Hoja: Detalle ======================= */
    const wsDet = wb.addWorksheet("Detalle", { properties: { defaultRowHeight: 18 } });
    wsDet.columns = [
      { header: "Fecha/Hora", key: "fecha",    width: 22 },
      { header: "Sala",       key: "sala",     width: 20 },
      { header: "Estado",     key: "estado",   width: 16 },
      { header: "Cliente",    key: "cliente",  width: 34 },
      { header: "Personas",   key: "personas", width: 12 },
      { header: "Monto (Q)",  key: "monto",    width: 14 },
      { header: "Notas",      key: "notas",    width: 40 },
    ];

    // Header con estilos
    const detHeader = wsDet.addRow(["Fecha/Hora","Sala","Estado","Cliente","Personas","Monto (Q)","Notas"]);
    const detHeaderIdx = detHeader.number;
    detHeader.eachCell((cell) => {
      cell.font = { bold: true, color: { argb: "FFFFFFFF" } };
      cell.alignment = { horizontal: "center", vertical: "middle" };
      cell.fill = { type: "pattern", pattern: "solid", fgColor: { argb: "FF4B5563" } };
    });

    // Filas detalle
    (detalle || []).forEach(r => {
      wsDet.addRow([
        r.fecha || "",
        r.sala || "",
        r.estado || "",
        r.cliente || "",
        Number(r.personas || 0),
        Number(r.monto || 0),
        r.notas || "",
      ]);
    });

    // Formatos y bordes
    for (let i = detHeaderIdx + 1; i <= wsDet.lastRow.number; i++) {
      wsDet.getCell(`E${i}`).alignment = { horizontal: "right" }; // personas
      wsDet.getCell(`F${i}`).numFmt = '#,##0.00';                 // monto
      wsDet.getCell(`F${i}`).alignment = { horizontal: "right" };
      for (let col = 1; col <= 7; col++) {
        wsDet.getRow(i).getCell(col).border = {
          top: { style: "thin" }, left: { style: "thin" },
          bottom: { style: "thin" }, right: { style: "thin" },
        };
      }
    }
    for (let col = 1; col <= 7; col++) {
      wsDet.getRow(detHeaderIdx).getCell(col).border = {
        top: { style: "thin" }, left: { style: "thin" },
        bottom: { style: "thin" }, right: { style: "thin" },
      };
    }

    /* ====== Respuesta ====== */
    const fname = `reportes_eventos_${yyyymmdd_hhmmss(now)}.xlsx`;
    res.setHeader("Content-Type", "application/vnd.openxmlformats-officedocument.spreadsheetml.sheet");
    res.setHeader("Content-Disposition", `attachment; filename=${fname}`);
    await wb.xlsx.write(res);
    res.end();

  } catch (err) {
    console.error("❌ Error generarReportesEventosExcel:", err);
    return res.status(500).json({ message: "Error al generar Excel." });
  } finally {
    if (cn) try { await cn.close(); } catch {}
  }
};
