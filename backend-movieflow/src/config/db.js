const oracledb = require('oracledb');

async function getConnection() {
  try {
    const connectString = '(description=(retry_count=20)(retry_delay=3)(address=(protocol=tcps)(port=1522)(host=adb.sa-bogota-1.oraclecloud.com))(connect_data=(service_name=g0fe86aee47d9c9_movieflownew_high.adb.oraclecloud.com))(security=(ssl_server_dn_match=yes)))';

    const connection = await oracledb.getConnection({
      user: 'ADMIN',
      password: 'Movieflow202618Semitec',
      connectString
    });

    console.log('✅ Conectado exitosamente a Oracle Autonomous Database');
    return connection;

  } catch (err) {
    console.error('❌ Error de conexión a Oracle:', err);
    throw err;
  }
}

module.exports = { getConnection };
