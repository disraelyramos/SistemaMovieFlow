// backend-movieflow/src/controllers/excel/ventasCategoria.controller.js
const db = require("../../config/db");
const oracledb = require("oracledb");
const ExcelJS = require("exceljs");

const z = (n) => String(n).padStart(2, "0");
const fmtFecha = (d) => `${z(d.getDate())}/${z(d.getMonth() + 1)}/${d.getFullYear()}`;
const fmtHora  = (d) => `${z(d.getHours())}:${z(d.getMinutes())}:${z(d.getSeconds())}`;
const yyyymmdd_hhmmss = (d) =>
  `${d.getFullYear()}${z(d.getMonth()+1)}${z(d.getDate())}_${z(d.getHours())}${z(d.getMinutes())}${z(d.getSeconds())}`;

/** quita "data:image/png;base64," si existe */
function normalizeBase64Image(b64 = "") {
  if (typeof b64 !== "string") return null;
  const i = b64.indexOf("base64,");
  return i >= 0 ? b64.slice(i + 7) : b64;
}

exports.generarVentasCategoriaExcel = async (req, res) => {
  let cn;
  try {
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
    const negocio = rsNeg.rows?.[0] || {};

    const wb = new ExcelJS.Workbook();
    const ws = wb.addWorksheet("Resumen", { properties: { defaultRowHeight: 18 } });

    // columnas A-J cómodas para layout
    ws.columns = Array.from({ length: 10 }, () => ({ width: 18 }));

    // Encabezado negocio
    ws.mergeCells("A1:J1");
    ws.getCell("A1").value = negocio.NOMBRE_CINE || "CineFlow";
    ws.getCell("A1").font = { bold: true, size: 16 };
    ws.getCell("A1").alignment = { horizontal: "center" };

    ws.mergeCells("A2:J2");
    const linea2 = [
      negocio.DIRECCION || "",
      negocio.TELEFONO ? `Tel: ${negocio.TELEFONO}` : "",
      negocio.CORREO ? `• ${negocio.CORREO}` : ""
    ].filter(Boolean).join("   •   ");
    ws.getCell("A2").value = linea2;
    ws.getCell("A2").alignment = { horizontal: "center" };

    // Título
    ws.mergeCells("A4:J4");
    ws.getCell("A4").value = "REPORTE DE VENTAS POR CATEGORÍA";
    ws.getCell("A4").font = { bold: true, size: 14 };
    ws.getCell("A4").alignment = { horizontal: "center" };

    const now = new Date();
    ws.getCell("A5").value = `Fecha generación: ${fmtFecha(now)}`;
    ws.getCell("J5").value = `Hora: ${fmtHora(now)}`;
    ws.getCell("J5").alignment = { horizontal: "right" };

    // Filtros
    let row = 7;
    ws.getCell(`A${row}`).value = "Filtros";
    ws.getCell(`A${row}`).font = { bold: true, size: 12 }; row++;

    const putLblVal = (lbl, val) => {
      ws.getCell(`A${row}`).value = lbl; ws.getCell(`A${row}`).font = { bold: true };
      ws.getCell(`B${row}`).value = val ?? "-"; row++;
    };

    const rango = (filtros.desde || filtros.hasta) ? `${filtros.desde || "-"} a ${filtros.hasta || "-"}` : "-";
    putLblVal("Rango:", rango);
    row++;

    // KPIs por categoría (totales y % participación)
    ws.getCell(`A${row}`).value = "Resumen por categoría";
    ws.getCell(`A${row}`).font = { bold: true, size: 12 }; row++;

    const headers = ["Categoría", "Total (Q)", "Participación %", "Variación vs mes ant. %"];
    ws.addRow(headers);
    const headRow = ws.lastRow;
    headRow.eachCell(c => {
      c.font = { bold: true, color: { argb: "FFFFFFFF" } };
      c.alignment = { horizontal: "center" };
      c.fill = { type: "pattern", pattern: "solid", fgColor: { argb: "FF4B5563" } };
    });

    const t = resumen.totales || {};
    const p = resumen.participacion || {};
    const m = resumen.variacion_mom || {};
    const rows = [
      { cat: "Snacks (Caja)",    total: Number(t.snacks_caja || 0),    part: Number(p.snacks_caja ?? 0),    mom: m.snacks_caja },
      { cat: "Combos (Caja)",    total: Number(t.combos_caja || 0),    part: Number(p.combos_caja ?? 0),    mom: m.combos_caja },
      { cat: "Snacks (Cliente)", total: Number(t.snacks_cliente || 0), part: Number(p.snacks_cliente ?? 0), mom: m.snacks_cliente },
    ];
    const totalGeneral = rows.reduce((acc, r) => acc + r.total, 0);

    rows.forEach(r => {
      ws.addRow([
        r.cat,
        r.total,
        r.part / 100, // formato %
        (r.mom === null || isNaN(r.mom)) ? null : r.mom / 100,
      ]);
    });

    // formatos numéricos
    for (let i = headRow.number + 1; i <= ws.lastRow.number; i++) {
      ws.getCell(`B${i}`).numFmt = '#,##0.00';
      ws.getCell(`C${i}`).numFmt = '0.0%';
      ws.getCell(`D${i}`).numFmt = '0.0%';
      ws.getCell(`B${i}`).alignment = { horizontal: "right" };
      ws.getCell(`C${i}`).alignment = { horizontal: "right" };
      ws.getCell(`D${i}`).alignment = { horizontal: "right" };
    }

    // total
    ws.addRow(["TOTAL", totalGeneral, null, null]);
    const totalRow = ws.lastRow;
    totalRow.getCell(1).font = { bold: true };
    totalRow.getCell(2).font = { bold: true };
    totalRow.getCell(2).numFmt = '#,##0.00';
    totalRow.getCell(2).alignment = { horizontal: "right" };

    row = ws.lastRow.number + 2;

    // Gráficas si vienen
    ws.mergeCells(`A${row}:E${row}`); ws.getCell(`A${row}`).value = "Participación por Categoría (Gráfica)";
    ws.getCell(`A${row}`).font = { bold: true }; 
    ws.mergeCells(`F${row}:J${row}`); ws.getCell(`F${row}`).value = "Comparativa de Ventas (Gráfica)";
    ws.getCell(`F${row}`).font = { bold: true }; row++;

    const imgPie = normalizeBase64Image(charts.imgPie);
    const imgBar = normalizeBase64Image(charts.imgBar);

    if (imgPie) {
      const id = wb.addImage({ base64: imgPie, extension: "png" });
      ws.mergeCells(`A${row}:E${row + 16}`); ws.addImage(id, `A${row}:E${row + 16}`);
    }
    if (imgBar) {
      const id = wb.addImage({ base64: imgBar, extension: "png" });
      ws.mergeCells(`F${row}:J${row + 16}`); ws.addImage(id, `F${row}:J${row + 16}`);
    }

    const fname = `reporte_ventas_categoria_${yyyymmdd_hhmmss(new Date())}.xlsx`;
    res.setHeader("Content-Type", "application/vnd.openxmlformats-officedocument.spreadsheetml.sheet");
    res.setHeader("Content-Disposition", `attachment; filename=${fname}`);
    await wb.xlsx.write(res);
    res.end();

  } catch (err) {
    console.error("❌ Error generarVentasCategoriaExcel:", err);
    return res.status(500).json({ message: "Error al generar Excel." });
  } finally {
    try { await cn?.close(); } catch {}
  }
};
