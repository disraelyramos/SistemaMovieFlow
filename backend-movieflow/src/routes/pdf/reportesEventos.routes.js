// routes/pdf/reportesEventos.routes.js
const express = require("express");
const router = express.Router();

const { generarReporteEventosPDF } = require("../../controllers/pdf/reportesEventos.controller");

// Si usas auth, colócala aquí: e.g., verifyToken
// router.post("/reportes-eventos", verifyToken, generarReporteEventosPDF);

router.post("/reportes-eventos", generarReporteEventosPDF);

module.exports = router;
