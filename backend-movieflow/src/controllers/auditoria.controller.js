// src/controllers/auditoria.controller.js
const db = require('../config/db');
const oracledb = require('oracledb');

async function registrarAuditoria({
  id_admin,
  id_usuario_editado,
  campo_modificado,
  valor_anterior,
  valor_nuevo
}) {
  let connection;

  try {
    // Validación de campos obligatorios
    if (!id_admin || !id_usuario_editado || !campo_modificado) {
      return;
    }

    connection = await db.getConnection();

    // 👉 Tabla correcta: POS_REGISTRO_AUDITORIA
    const sql = `
      INSERT INTO POS_REGISTRO_AUDITORIA (
        ID_ADMIN,
        ID_USUARIO_EDITADO,
        CAMPO_MODIFICADO,
        VALOR_ANTERIOR,
        VALOR_NUEVO,
        FECHA_HORA_MODIFICACION
      ) VALUES (
        :id_admin,
        :id_usuario_editado,
        :campo_modificado,
        :valor_anterior,
        :valor_nuevo,
        SYSTIMESTAMP
      )
    `;

    await connection.execute(
      sql,
      {
        id_admin,
        id_usuario_editado,
        campo_modificado,
        valor_anterior: valor_anterior ?? null,
        valor_nuevo: valor_nuevo ?? null
      },
      { autoCommit: true }
    );
  } catch (error) {
    // Si por alguna razón la tabla no existe en este ambiente, no rompemos el flujo principal
    if (!(error && error.errorNum === 942)) {
      // Silencioso: se mantiene el comportamiento de no propagar el error
    }
  } finally {
    try {
      await connection?.close();
    } catch {
      /* no-op */
    }
  }
}

module.exports = { registrarAuditoria };
