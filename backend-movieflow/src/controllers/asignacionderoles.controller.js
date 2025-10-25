// src/controllers/asignacionderoles.controller.js
const db = require('../config/db');
const oracledb = require('oracledb');

/**
 * Registra un nuevo rol si no está duplicado.
 */
exports.crearRol = async (req, res) => {
  const { nombre } = req.body;
  if (!nombre || typeof nombre !== 'string') {
    return res.status(400).json({ message: 'Nombre de rol inválido' });
  }

  const nombreLimpio = nombre.trim();
  if (!nombreLimpio) {
    return res.status(400).json({ message: 'El nombre es obligatorio.' });
  }

  let connection;

  try {
    connection = await db.getConnection();

    // Verificar duplicado
    const result = await connection.execute(
      `SELECT COUNT(*) AS cantidad FROM roles WHERE LOWER(nombre) = LOWER(:nombre)`,
      [nombreLimpio],
      { outFormat: oracledb.OUT_FORMAT_OBJECT }
    );

    if (result.rows[0].CANTIDAD > 0) {
      return res.status(409).json({ message: 'El rol ya existe' });
    }

    // Insertar nuevo rol (ID por secuencia)
    await connection.execute(
      `INSERT INTO roles (id, nombre) VALUES (ROLES_SEQ.NEXTVAL, :nombre)`,
      [nombreLimpio],
      { autoCommit: true }
    );

    return res.status(201).json({ message: 'Rol registrado correctamente' });
  } catch (error) {
    const msg = String(error?.message || '');
    const code = String(error?.code || '');

    if (msg.includes('ORA-00001') || code === 'ORA-00001') {
      return res.status(409).json({ message: 'Ya existe un rol con ese nombre.' });
    }
    if (msg.includes('ORA-01400') || code === 'ORA-01400') {
      return res.status(400).json({ message: 'Falta un dato requerido (revisa NOMBRE o columnas NOT NULL).' });
    }
    if (msg.includes('ORA-12899') || code === 'ORA-12899') {
      return res.status(400).json({ message: 'El nombre excede la longitud permitida.' });
    }

    console.error('Error al registrar rol:', error);
    return res.status(500).json({ message: 'Error interno del servidor' });
  } finally {
    if (connection) {
      try { await connection.close(); } catch (err) {
        console.error('Error al cerrar conexión:', err);
      }
    }
  }
};
