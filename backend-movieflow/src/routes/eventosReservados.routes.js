const { Router } = require('express');
const controller = require('../controllers/eventosReservados.controller');

// Prefijo ya se aplica en server.js: app.use('/api/eventos-reservados', router)
const router = Router();

/** Slots y disponibilidad */
router.get('/slots', controller.obtenerSlots);
router.get('/disponibilidad', controller.disponibilidad);

/** 👇 NUEVO: comprobante PDF de un evento (stream PDF) */
router.get('/:id/pdf', controller.comprobantePdfEvento);

/** 👇 Primero /mis para evitar que cualquier middleware intercepte rutas dinámicas */
router.get('/mis', controller.listarMisEventos);

/** CRUD general */
router.post('/', controller.crearEventoReservado);
router.get('/', controller.listarEventosReservados);
router.put('/:id', controller.actualizarEventoReservado);

/** Cancelación (soporta ambas rutas para no romper integraciones previas) */
router.patch('/:id/cancelar', controller.cancelarEventoReservado);
router.patch('/:id/cancel',   controller.cancelarEventoReservado);

module.exports = router;
