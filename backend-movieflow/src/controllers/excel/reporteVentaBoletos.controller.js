// src/controllers/excel/reporteVentaBoletos.controller.js
const db = require("../../config/db");
const oracledb = require("oracledb");
const ExcelJS = require("exceljs");

/* ===== Utilidades de fecha/hora ===== */
const z = n => String(n).padStart(2, "0");
const fmtFecha = d => `${z(d.getDate())}/${z(d.getMonth() + 1)}/${d.getFullYear()}`;
const fmtHora  = d => `${z(d.getHours())}:${z(d.getMinutes())}:${z(d.getSeconds())}`;
const yyyymmdd_hhmmss = d =>
  `${d.getFullYear()}${z(d.getMonth()+1)}${d.getDate().toString().padStart(2,"0")}_${z(d.getHours())}${z(d.getMinutes())}${z(d.getSeconds())}`;

exports.generarReporteVentaBoletosExcel = async (req, res) => {
  let cn;
  try {
    const { filtros = {}, rows, total } = req.body || {};
    if (!Array.isArray(rows) || rows.length === 0) {
      return res.status(400).json({ message: "No hay filas para exportar." });
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

    // Workbook / Worksheet
    const wb = new ExcelJS.Workbook();
    const ws = wb.addWorksheet("Venta de Boletos", { properties: { defaultRowHeight: 18 } });

    ws.columns = [
      { header: "Sala",                key: "sala",              width: 28 },
      { header: "Funciones",           key: "funciones",         width: 14 },
      { header: "Capacidad",           key: "capacidad",         width: 14 },
      { header: "Boletos vendidos",    key: "boletos_vendidos",  width: 18 },
      { header: "Total ingresos (Q)",  key: "total_ingresos",    width: 20 },
      { header: "Fecha",               key: "fecha",             width: 18 },
    ];

    // Encabezado
    ws.mergeCells("A1:F1");
    ws.getCell("A1").value = negocio.NOMBRE_CINE || "CineFlow";
    ws.getCell("A1").font = { bold: true, size: 16 };
    ws.getCell("A1").alignment = { horizontal: "center" };

    ws.mergeCells("A2:F2");
    const linea2 = [
      negocio.DIRECCION || "",
      negocio.TELEFONO ? `Tel: ${negocio.TELEFONO}` : "",
      negocio.CORREO ? `• ${negocio.CORREO}` : ""
    ].filter(Boolean).join("   •   ");
    ws.getCell("A2").value = linea2;
    ws.getCell("A2").alignment = { horizontal: "center" };

    ws.mergeCells("A4:F4");
    ws.getCell("A4").value = "REPORTE DE VENTA DE BOLETOS POR SALA";
    ws.getCell("A4").font = { bold: true, size: 14 };
    ws.getCell("A4").alignment = { horizontal: "center" };

    const now = new Date();
    ws.getCell("A5").value = `Fecha generación: ${fmtFecha(now)}`;
    ws.getCell("F5").value = `Hora: ${fmtHora(now)}`;
    ws.getCell("F5").alignment = { horizontal: "right" };

    // Filtros
    const filtrosData = [
      ["Periodo:", filtros.periodo || filtros.modo || "—"],
      ["Sala:", filtros.salaNombre || filtros.sala || "Todas"],
      ["Rango:", filtros.rangoLabel || filtros.fecha || "—"],
    ];
    if ((filtros.periodo || filtros.modo) === "PERSONALIZADO") {
      filtrosData.push(["Fecha Desde:", filtros.desde || ""]);
      filtrosData.push(["Fecha Hasta:", filtros.hasta || ""]);
    }

    let fila = 7;
    for (const [label, value] of filtrosData) {
      ws.getCell(`A${fila}`).value = label;
      ws.getCell(`A${fila}`).font = { bold: true };
      ws.getCell(`B${fila}`).value = value;
      fila++;
    }

    // Línea en blanco y cabecera de tabla
    ws.addRow([]);
    const header = ws.addRow(["Sala","Funciones","Capacidad","Boletos vendidos","Total ingresos (Q)","Fecha"]);
    const headerRowIdx = header.number;
    header.eachCell((cell) => {
      cell.font = { bold: true, color: { argb: "FFFFFFFF" } };
      cell.alignment = { horizontal: "center", vertical: "middle" };
      cell.fill = { type: "pattern", pattern: "solid", fgColor: { argb: "FF4B5563" } };
    });
    const startDataRow = header.number + 1;

    // Datos
    rows.forEach(r => {
      const sala              = r.SALA ?? r.sala ?? "";
      const funciones         = Number(r.FUNCIONES ?? r.funciones ?? 0);
      const capacidad         = Number(r.CAPACIDAD ?? r.capacidad ?? 0);
      const boletosVendidos   = Number(r.BOLETOS_VENDIDOS ?? r.boletos_vendidos ?? 0);
      const totalIngresos     = Number(r.TOTAL_INGRESOS ?? r.total_ingresos ?? r["TOTAL DE INGRESOS"] ?? 0);
      const fecha             = r.FECHA ?? r.fecha ?? "";

      ws.addRow([sala, funciones, capacidad, boletosVendidos, totalIngresos, fecha]);
    });

    // Formatos numéricos / alineación
    const lastDataRow = ws.lastRow.number;
    for (let i = startDataRow; i <= lastDataRow; i++) {
      ws.getCell(`B${i}`).alignment = { horizontal: "right" };
      ws.getCell(`C${i}`).alignment = { horizontal: "right" };
      ws.getCell(`D${i}`).alignment = { horizontal: "right" };
      ws.getCell(`E${i}`).alignment = { horizontal: "right" };
      ws.getCell(`E${i}`).numFmt = '"Q"#,##0.00';
      ws.getCell(`F${i}`).alignment = { horizontal: "center" };
    }

    // Total
    const totalCalculado = rows.reduce(
      (acc, r) => acc + (Number(r.TOTAL_INGRESOS ?? r.total_ingresos ?? r["TOTAL DE INGRESOS"]) || 0),
      0
    );
    const totalFinal = Number.isFinite(Number(total)) ? Number(total) : totalCalculado;

    const totalRow = ws.addRow(["", "", "", "Total general de ingresos", totalFinal, ""]);
    totalRow.font = { bold: true };
    totalRow.getCell(4).alignment = { horizontal: "right" };
    totalRow.getCell(5).numFmt = '"Q"#,##0.00';
    const totalRowIdx = totalRow.number;

    // Bordes A–F
    const applyBorders = ({ top, left, bottom, right }) => {
      for (let r = top; r <= bottom; r++) {
        for (let c = left; c <= right; c++) {
          ws.getRow(r).getCell(c).border = {
            top:    { style: "thin" },
            left:   { style: "thin" },
            bottom: { style: "thin" },
            right:  { style: "thin" },
          };
        }
      }
    };
    applyBorders({ top: headerRowIdx, left: 1, bottom: totalRowIdx, right: 6 });

    // Congelar hasta cabecera
    ws.views = [{ state: "frozen", ySplit: headerRowIdx }];

    // Respuesta
    const fname = `reporte_venta_boletos_${yyyymmdd_hhmmss(now)}.xlsx`;
    res.setHeader("Content-Type", "application/vnd.openxmlformats-officedocument.spreadsheetml.sheet");
    res.setHeader("Content-Disposition", `attachment; filename=${fname}`);
    await wb.xlsx.write(res);
    res.end();

  } catch (err) {
    console.error("❌ Error generarReporteVentaBoletosExcel:", err);
    return res.status(500).json({ message: "Error al generar Excel." });
  } finally {
    if (cn) try { await cn.close(); } catch {}
  }
};
