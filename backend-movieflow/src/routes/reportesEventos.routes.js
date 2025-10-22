// src/routes/reportesEventos.routes.js
const { Router } = require('express');
const ctrl = require('../controllers/reportesEventos.controller');

const router = Router();
router.get('/reportes/eventos', ctrl.listar);

module.exports = router;
