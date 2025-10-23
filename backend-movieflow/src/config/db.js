const oracledb = require("oracledb");
const path = require("path");
const fs = require("fs");

async function getConnection() {
  try {
    // Carpeta del wallet (donde están tnsnames.ora y sqlnet.ora)
    const walletPath = path.resolve(__dirname, "wallet");

    if (!fs.existsSync(walletPath)) {
      throw new Error(`⚠️ No se encontró el wallet en: ${walletPath}`);
    }

    // 👉 Clave: dile al driver dónde está el tnsnames.ora
    process.env.TNS_ADMIN = walletPath;
    console.log("DBG TNS_ADMIN =", process.env.TNS_ADMIN);

    // Conecta usando el alias del tnsnames.ora
    const connection = await oracledb.getConnection({
      user: "ADMIN",
      password: "Movieflow202618Semitec",
      connectString: "movieflownewpub_high",
    });

    console.log("✅ Conectado exitosamente a Oracle Cloud (Wallet)");
    return connection;
  } catch (err) {
    console.error("❌ Error de conexión a Oracle:", err);
    throw err;
  }
}

module.exports = { getConnection };
