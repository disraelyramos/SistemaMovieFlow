const oracledb = require('oracledb');

async function getConnection() {
  try {
    const connectString = process.env.ORACLE_CONNECT_STRING;
    const user = process.env.ORACLE_USER;
    const password = process.env.ORACLE_PASSWORD;

    const connection = await oracledb.getConnection({
      user,
      password,
      connectString,
    });

    console.log('✅ Conectado exitosamente a Oracle Autonomous Database');
    return connection;

  } catch (err) {
    console.error('❌ Error de conexión a Oracle:', err);
    throw err;
  }
}

module.exports = { getConnection };
