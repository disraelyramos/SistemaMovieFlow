// src/routes/reportesVentaBoletos.routes.js
const router = require('express').Router();
const { getReporteVentaBoletos } =
  require('../controllers/graficas_reportes/reportesVentadeBoletos.controller.js');



router.get('/reporte-venta-boletos', getReporteVentaBoletos);
module.exports = router;
