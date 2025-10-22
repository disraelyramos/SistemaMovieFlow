// routes/excel/ReportesEventos.routes.js
const express = require("express");
const router = express.Router();

const { generarReportesEventosExcel } = require("../../controllers/excel/reportesEventos.controller");

// Si usas un middleware de auth, agrégalo aquí (por ejemplo: verifyToken)
// router.post("/reportes-eventos", verifyToken, generarReportesEventosExcel);

router.post("/reportes-eventos", generarReportesEventosExcel);

module.exports = router;
