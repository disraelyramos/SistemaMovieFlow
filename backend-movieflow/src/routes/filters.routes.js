// src/routes/filters.routes.js
const { Router } = require('express');
const { getSalasFiltro } = require('../controllers/filters/filtros.controller');
const router = Router();

// ENDPOINT: solo para combos/filtros
router.get('/filtros/salas', getSalasFiltro);

module.exports = router;
