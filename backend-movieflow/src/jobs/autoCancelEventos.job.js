// backend-movieflow/src/jobs/autoCancelEventos.job.js
let cron = null;
try {
  cron = require('node-cron');
} catch (_) {
  cron = null;
}

const db = require('../config/db');
const oracledb = require('oracledb');

/**
 * AUTO CANCELACIÓN DE EVENTOS
 * - Cancela automáticamente eventos en estado RESERVADO o PENDIENTE
 *   si faltan menos de 24h y no tienen un pago registrado.
 * - Soporta EVENTOS_ESPECIALES (actual) y EVENTOS_RESERVADOS (legado).
 */
async function runAutoCancel() {
  let conn;
  try {
    conn = await db.getConnection();

    const tableExists = async (name) => {
      const r = await conn.execute(
        `SELECT COUNT(*) AS N FROM USER_TABLES WHERE TABLE_NAME = :t`,
        { t: name.toUpperCase() },
        { outFormat: oracledb.OBJECT }
      );
      return (r.rows?.[0]?.N || 0) > 0;
    };

    const hasEspeciales = await tableExists('EVENTOS_ESPECIALES');
    const hasReservados = await tableExists('EVENTOS_RESERVADOS');
    const hasPagos = await tableExists('POS_PAGO_EVENTO');

    if (!hasPagos || (!hasEspeciales && !hasReservados)) return;

    // 1️⃣ EVENTOS_ESPECIALES
    if (hasEspeciales) {
      await conn.execute(
        `
        UPDATE EVENTOS_ESPECIALES e
           SET e.ESTADO = 'CANCELADO'
         WHERE e.ESTADO IN ('RESERVADO','PENDIENTE')
           AND e.START_TS <= SYSTIMESTAMP + INTERVAL '1' DAY
           AND NOT EXISTS (
             SELECT 1
               FROM POS_PAGO_EVENTO p
              WHERE p.EVENTO_ID = e.ID_EVENTO
                AND NVL(UPPER(p.ESTADO),'X') IN ('PAGADO','CONFIRMADO')
           )
        `,
        [],
        { autoCommit: false }
      );
    }

    // 2️⃣ EVENTOS_RESERVADOS (legado)
    if (hasReservados) {
      // Detectar nombre real del campo PK
      const colCheck = await conn.execute(
        `SELECT COLUMN_NAME FROM USER_TAB_COLUMNS WHERE TABLE_NAME = 'EVENTOS_RESERVADOS'`
      );
      const cols = colCheck.rows.map(r => r[0]);
      const idCol = cols.find(c => /ID_EVENTO|ID_RESERVA|ID/i.test(c)) || 'ID';

      await conn.execute(
        `
        UPDATE EVENTOS_RESERVADOS r
           SET r.ESTADO = 'CANCELADO'
         WHERE r.ESTADO IN ('RESERVADO','PENDIENTE')
           AND (
                CAST(r.FECHA AS TIMESTAMP)
                + NUMTODSINTERVAL(
                    TO_NUMBER(SUBSTR(r.HORA_INICIO,1,2))*60
                  + TO_NUMBER(SUBSTR(r.HORA_INICIO,4,2)),
                  'MINUTE'
                )
               ) <= SYSTIMESTAMP + INTERVAL '1' DAY
           AND NOT EXISTS (
             SELECT 1
               FROM POS_PAGO_EVENTO p
              WHERE p.EVENTO_ID = r.${idCol}
                AND NVL(UPPER(p.ESTADO),'X') IN ('PAGADO','CONFIRMADO')
           )
        `,
        [],
        { autoCommit: false }
      );
    }

    await conn.commit();
    console.log('[JOB] AutoCancel ejecutado correctamente');
  } catch (err) {
    console.error('[JOB] Error en autoCancelEventos:', err?.message || err);
  } finally {
    if (conn) {
      try { await conn.close(); } catch (_) {}
    }
  }
}

/**
 * Programa el job para el minuto 5 de cada hora (zona América/Guatemala)
 */
function startAutoCancelJob() {
  runAutoCancel(); // Ejecutar al iniciar

  if (cron) {
    cron.schedule('5 * * * *', runAutoCancel, { timezone: 'America/Guatemala' });
    console.log('[JOB] autoCancelEventos programado con node-cron (min 5 de cada hora)');
  } else {
    console.warn('[JOB] node-cron no instalado. Usando fallback cada hora.');
    setInterval(runAutoCancel, 60 * 60 * 1000);
  }
}

module.exports = { startAutoCancelJob, runAutoCancel };
