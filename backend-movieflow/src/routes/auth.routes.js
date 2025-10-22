const express = require('express');
const router = express.Router();
const authController = require('../controllers/auth.controller');

// 🔹 LOGIN normal (POST /login)
router.post('/', authController.login);

// 🔹 CAMBIO DE CONTRASEÑA EN PRIMER LOGIN (POST /login/primer-cambio)
router.post('/primer-cambio', authController.cambiarPasswordPrimerLogin);

module.exports = router;
