const oracledb = require('oracledb');
async function getConnection() {
  return await oracledb.getConnection({
    user: process.env.ORACLE_USER,
    password: process.env.ORACLE_PASSWORD,
    connectString: process.env.ORACLE_CONNECT_STRING, // <- alias
  });
}
module.exports = { getConnection };
