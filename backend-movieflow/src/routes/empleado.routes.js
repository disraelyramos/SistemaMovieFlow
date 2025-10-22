// src/routes/empleado.routes.js
const { Router } = require('express');
const router = Router();

const ctrl = require('../controllers/empleado.controller');
// middleware de auth si lo necesitas: const { verificarTokenEmpleado } = require('../middlewares/authEmpleado');

// Listados
router.get('/empleado/cartelera', ctrl.getCartelera);
router.get('/empleado/cartelera/:peliculaId/funciones', ctrl.getFuncionesByPelicula);
router.get('/empleado/funciones/:funcionId/asientos', ctrl.getAsientosByFuncion);

// Acciones
router.post('/empleado/funciones/:funcionId/vender', ctrl.postVender);
// Liberar reservas expiradas antes de cargar asientos
router.post('/empleado/funciones/:funcionId/liberar-reservas-vencidas', ctrl.postLiberarReservasVencidas);


// Listar reservas (agrupadas) de una función
router.get('/empleado/funciones/:funcionId/reservas', ctrl.getReservasByFuncion);

// Confirmar una reserva por número
router.post('/empleado/funciones/:funcionId/confirmar-reserva', ctrl.postConfirmarReservaPorNumero);


module.exports = router;

// Tickets en PDF
router.get('/empleado/tickets/compra/:compraId', ctrl.getTicketsPdfByCompra);

// Opcional: tickets por número de reserva ya confirmada (conviene para el panel derecho)
router.get('/empleado/funciones/:funcionId/reservas/:numeroReserva/tickets', ctrl.getTicketsPdfByReserva);

