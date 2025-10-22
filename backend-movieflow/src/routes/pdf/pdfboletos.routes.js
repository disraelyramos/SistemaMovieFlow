// src/routes/pdf/pdfboletos.js
const router = require("express").Router();
const { generarReporteVentaBoletosPDF } = require("../../controllers/pdf/reporteVentaBoletos.controller");

router.post("/reporte-venta-boletos", generarReporteVentaBoletosPDF);

module.exports = router;
