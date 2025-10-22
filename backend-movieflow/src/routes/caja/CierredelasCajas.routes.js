const express = require("express");
const router = express.Router();

// OJO: desde routes/caja/ hasta controllers/caja/ son DOS niveles
const Ctrl = require("../../controllers/caja/CierredelasCajas.controller");

// 🔎 sanity check (abre en el navegador para verificar que el router sí está montado)
router.get('/ping', (req, res) => res.json({ ok: true, scope: 'cierre-de-caja' }));

// Endpoints que llama tu front con /api/cierre-de-caja/*
router.get("/apertura-activa", Ctrl.getCajasAbiertas);           // ?usuario_id=#
router.get("/info", Ctrl.getInfoCierreCaja);                     // ?usuario_id=#&id_apertura=#
router.get("/pagos-reservas-total", Ctrl.pagosReservasTotal);    // ?apertura_id=#
router.post("/", Ctrl.registrarCierre);                          // body cierre

module.exports = router;
