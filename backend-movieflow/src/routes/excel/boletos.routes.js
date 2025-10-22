// src/routes/excel/boletos.routes.js
const router = require("express").Router();
const { generarReporteVentaBoletosExcel } = require("../../controllers/excel/reporteVentaBoletos.controller");

router.post("/reporte-venta-boletos", generarReporteVentaBoletosExcel);

module.exports = router;
