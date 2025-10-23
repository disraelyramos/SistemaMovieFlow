// src/config/db.js
const oracledb = require('oracledb');
const fs = require('fs');
const path = require('path');

const TNS_ADMIN = process.env.TNS_ADMIN || path.join(__dirname, 'wallet');
const CONNECT_ALIAS = (process.env.ORACLE_CONNECT_STRING || '').trim();

if (!fs.existsSync(TNS_ADMIN)) {
  throw new Error(`⚠️ No se encontró el wallet en: ${TNS_ADMIN}`);
}
if (!CONNECT_ALIAS) {
  throw new Error('⚠️ Falta ORACLE_CONNECT_STRING (alias del tnsnames.ora).');
}

// Validación rápida: el alias debe existir en tnsnames.ora
try {
  const tns = fs.readFileSync(path.join(TNS_ADMIN, 'tnsnames.ora'), 'utf8');
  const aliasRegex = new RegExp(`^\\s*${CONNECT_ALIAS}\\s*=`, 'mi');
  if (!aliasRegex.test(tns)) {
    console.warn(`[TNS] Alias "${CONNECT_ALIAS}" no aparece en tnsnames.ora. Revisa el nombre.`);
  }
} catch (e) {
  console.warn('[TNS] No se pudo leer tnsnames.ora para validar alias:', e.message);
}

async function getConnection() {
  return await oracledb.getConnection({
    user: process.env.ORACLE_USER,
    password: process.env.ORACLE_PASSWORD,
    connectString: CONNECT_ALIAS, // <- SOLO alias del tnsnames.ora
    externalAuth: false
  });
}

module.exports = { getConnection };
