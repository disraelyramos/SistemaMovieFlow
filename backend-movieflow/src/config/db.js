const oracledb = require('oracledb');
require('dotenv').config();

async function getConnection() {
  try {
    const connection = await oracledb.getConnection({
      user: process.env.DB_USER,
      password: process.env.DB_PASSWORD,
      connectString: process.env.DB_CONNECT_STRING
    });
    console.log("✅ Conexión exitosa a Oracle");
    return connection;
  } catch (err) {
    console.error("❌ Error de conexión a Oracle:", err);
    throw err;
  }
}

module.exports = { getConnection };
