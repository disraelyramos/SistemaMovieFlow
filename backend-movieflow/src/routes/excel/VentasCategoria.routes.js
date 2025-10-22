// backend-movieflow/src/routes/excel/VentasCategoria.routes.js
const express = require("express");
const router = express.Router();

const { generarVentasCategoriaExcel } = require("../../controllers/excel/ventasCategoria.controller");

// Si usas auth, colócala aquí
// router.post("/ventas-categoria", verifyToken, generarVentasCategoriaExcel);

router.post("/ventas-categoria", generarVentasCategoriaExcel);

module.exports = router;
