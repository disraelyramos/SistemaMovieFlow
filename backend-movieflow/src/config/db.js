const oracledb = require('oracledb');

async function getConnection() {
  try {
    const connection = await oracledb.getConnection({
      user: process.env.ORACLE_USER,
      password: process.env.ORACLE_PASSWORD,
      connectString: process.env.ORACLE_CONNECT_STRING
    });
    console.log('✅ Conectado exitosamente a Oracle');
    return connection;
  } catch (err) {
    console.error('❌ Error de conexión a Oracle:', err);
    throw err;
  }
}

module.exports = { getConnection };
