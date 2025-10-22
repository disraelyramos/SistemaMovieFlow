const { Router } = require('express');
const ctrl = require('../controllers/pagosReservas.controller');

const router = Router();

router.get('/por-cobrar', ctrl.listarPorCobrar);
router.post('/', ctrl.pagarEvento);
router.get('/ingresos', ctrl.ingresos);
router.get('/resumen-cobro', ctrl.resumenCobro);

// 👇 ESTO es clave:
module.exports = router;
