const bcrypt = require('bcrypt');
const { registrarAuditoria } = require('./auditoria.controller');
const db = require('../config/db');
const oracledb = require('oracledb');

const OUT_OBJ = { outFormat: oracledb.OUT_FORMAT_OBJECT };

/* ================= Reglas de contraseña (añadido) ================= */
function validarContrasena(pwd = '') {
  if (typeof pwd !== 'string') return 'La contraseña es inválida.';
  const errores = [];
  // 🔻 Regla de longitud removida (antes: pwd.length < 10)
  if (!/[A-Z]/.test(pwd)) errores.push('incluir al menos una letra mayúscula');
  if (!/[a-z]/.test(pwd)) errores.push('incluir al menos una letra minúscula');
  if (!/\d/.test(pwd)) errores.push('incluir al menos un número');
  if (!/[^A-Za-z0-9]/.test(pwd)) errores.push('incluir al menos un carácter especial (p. ej.: !@#$%&*)');

  if (errores.length) {
    const detalle = errores.join(', ').replace(/, ([^,]*)$/, ' y $1');
    return `La contraseña debe ${detalle}.`;
  }
  return null;
}

/* ================================================================ */

// ✅ GET: usuarios con nombre de estado y rol (sin PASSWORD_HASH)
exports.getUsuarios = async (req, res) => {
  let connection;
  try {
    connection = await db.getConnection();

    const result = await connection.execute(
      `SELECT 
         u.ID,
         u.NOMBRE,
         u.CORREO,
         u.USUARIO,
         u.ESTADO,
         r.NOMBRE AS ROLE_NOMBRE,
         e.NOMBRE AS ESTADO_NOMBRE
       FROM USUARIOS u
       JOIN ROLES r ON u.ROLE_ID = r.ID
       JOIN ESTADOS_USUARIO e ON u.ESTADO = e.ID
       ORDER BY u.ID DESC`,
      [],
      OUT_OBJ
    );

    return res.json(result.rows);
  } catch (error) {
    console.error('[ERROR] getUsuarios:', error);
    return res.status(500).json({ message: 'Error interno al obtener usuarios' });
  } finally {
    if (connection) await connection.close();
  }
};

// ✅ POST: crear usuario (con ES_PRIMER_LOGIN = 1)
exports.nuevoUsuario = async (req, res) => {
  const { nombre, correo, usuario, contrasena, estado, rol, id_admin } = req.body;
  let connection;

  try {
    connection = await db.getConnection();

    // (Opcional pero útil) Validación mínima (sin cambios)
    if (!nombre || !usuario || !contrasena) {
      return res.status(400).json({ message: 'Faltan campos obligatorios' });
    }

    // ✅ Validación de contraseña (añadido, sin romper la lógica)
    const errorPwd = validarContrasena(contrasena);
    if (errorPwd) {
      return res.status(400).json({
        message: errorPwd,
        code: 'PWD_POLICY_VIOLATION'
      });
    }

    // Hash de contraseña (sin cambios)
    const hashedPassword = await bcrypt.hash(contrasena, 10);

    // Insert explícito con ES_PRIMER_LOGIN = 1 (sin cambios)
    const result = await connection.execute(
      `INSERT INTO USUARIOS
         (NOMBRE, CORREO, USUARIO, PASSWORD_HASH, ESTADO, ROLE_ID, ES_PRIMER_LOGIN)
       VALUES
         (:nombre, :correo, :usuario, :password, :estado, :rol, 1)
       RETURNING ID INTO :id`,
      {
        nombre,
        correo,
        usuario,
        password: hashedPassword,
        estado,
        rol,
        id: { type: oracledb.NUMBER, dir: oracledb.BIND_OUT }
      },
      { autoCommit: true }
    );

    const nuevoId = result.outBinds.id[0];

    // Resolver nombres legibles para auditoría (sin cambios)
    const [estadoRes, rolRes] = await Promise.all([
      connection.execute(`SELECT NOMBRE FROM ESTADOS_USUARIO WHERE ID = :id`, [estado], OUT_OBJ),
      connection.execute(`SELECT NOMBRE FROM ROLES            WHERE ID = :id`, [rol],    OUT_OBJ)
    ]);

    const estadoNombre = estadoRes.rows?.[0]?.NOMBRE || `ID ${estado}`;
    const rolNombre    = rolRes.rows?.[0]?.NOMBRE    || `ID ${rol}`;

    const descripcion = `Nombre: ${nombre} | Usuario: ${usuario} | Correo: ${correo || ''} | Estado: ${estadoNombre} | Rol: ${rolNombre}`;

    // Auditoría (se mantiene tu llamada)
    await registrarAuditoria({
      id_admin,
      id_usuario_editado: nuevoId,
      campo_modificado: 'CREACIÓN',
      valor_anterior: null,
      valor_nuevo: descripcion
    });

    return res.status(201).json({
      message: 'Usuario creado exitosamente',
      id: nuevoId
    });
  } catch (error) {
    console.error('[ERROR] nuevoUsuario:', error);

    // Duplicados (índices únicos de USUARIO/CORREO)
    if (String(error?.message || '').includes('ORA-00001')) {
      return res.status(409).json({ message: 'Usuario o correo ya existe' });
    }

    return res.status(500).json({ message: 'Error interno al crear usuario' });
  } finally {
    if (connection) await connection.close();
  }
};
