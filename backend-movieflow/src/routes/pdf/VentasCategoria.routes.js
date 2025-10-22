// backend-movieflow/src/routes/pdf/VentasCategoria.routes.js
const express = require("express");
const router = express.Router();

const { generarReporteVentasCategoriaPDF } = require("../../controllers/pdf/ventasCategoria.controller");

// Si usas auth, colócala aquí (e.g. verifyToken)
// router.post("/ventas-categoria", verifyToken, generarReporteVentasCategoriaPDF);

router.post("/ventas-categoria", generarReporteVentasCategoriaPDF);

module.exports = router;
