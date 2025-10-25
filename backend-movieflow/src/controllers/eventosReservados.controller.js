// controllers/eventosReservados.controller.js
const oracledb = require('oracledb');
const db = require('../config/db');
const PDFDocument = require('pdfkit');
oracledb.outFormat = oracledb.OUT_FORMAT_OBJECT;

/* ================== Helpers fecha/hora (LOCAL) ================== */
const ymd = (d) =>
  `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, '0')}-${String(d.getDate()).padStart(2, '0')}`;

const pad2 = (n) => String(n).padStart(2, '0');
const hm = (d) => `${pad2(d.getHours())}:${pad2(d.getMinutes())}`;

const parseLocalDateTime = (yyyy_mm_dd, hh_mm) => {
  const [y, m, d] = yyyy_mm_dd.split('-').map(Number);
  const [hh, mm] = hh_mm.split(':').map(Number);
  return new Date(y, m - 1, d, hh, mm, 0, 0);
};
const startOfDay = (d) => { const x = new Date(d); x.setHours(0, 0, 0, 0); return x; };
const getConnection = async () => (db.getConnection ? db.getConnection() : db);

/* ================== Utilidades ================== */
function parseInputDate(str) {
  if (/^\d{4}-\d{2}-\d{2}$/.test(str)) {
    const [y, m, d] = str.split('-').map(Number);
    return new Date(y, m - 1, d, 0, 0, 0, 0);
  }
  if (/^\d{2}\/\d{2}\/\d{4}$/.test(str)) {
    const [d, m, y] = str.split('/').map(Number);
    return new Date(y, m - 1, d, 0, 0, 0, 0);
  }
  const t = new Date(str);
  if (Number.isNaN(t.getTime())) throw new Error('Fecha inválida');
  t.setHours(0, 0, 0, 0);
  return t;
}

/* ===== helper: existencia de tabla (maneja ESTUDIANTE.<name>) ===== */
async function tableExists(conn, name) {
  const up = name.toUpperCase();
  const [simple, prefixed] = await Promise.all([
    conn.execute(`SELECT COUNT(*) N FROM USER_TABLES WHERE TABLE_NAME = :t`, { t: up }),
    conn.execute(`SELECT COUNT(*) N FROM ALL_TABLES WHERE TABLE_NAME = :t AND OWNER = 'ESTUDIANTE'`, { t: up })
  ]);
  const n1 = simple.rows?.[0]?.N || simple.rows?.[0]?.n || 0;
  const n2 = prefixed.rows?.[0]?.N || prefixed.rows?.[0]?.n || 0;
  return (n1 > 0) || (n2 > 0);
}

/* =================================================================
   Parsers (IntervalDS / Date / Varchar2)
   ================================================================= */
const parseHoraMin = (v) => {
  if (v && typeof v === 'object' && 'hours' in v && 'minutes' in v && 'days' in v) {
    return (Number(v.days) || 0) * 1440 + (Number(v.hours) || 0) * 60 + (Number(v.minutes) || 0);
  }
  if (v instanceof Date && !Number.isNaN(v)) return v.getHours() * 60 + v.getMinutes();
  const s = String(v ?? '').trim();
  let m = s.match(/(\d{1,2}):(\d{2})/); if (m) return (+m[1]) * 60 + (+m[2]);
  m = s.match(/^(\d{1,2})(\d{2})$/);    if (m) return (+m[1]) * 60 + (+m[2]);
  return null;
};

/* -------- FUNCIONES del día por sala -------- */
async function _fetchFuncionesDiaSala(conn, salaId, dayStart) {
  const base = (colSala) => `
    SELECT FECHA, HORA_INICIO, HORA_FINAL, NVL(ESTADO,'VIGENTE') AS ESTADO
      FROM ESTUDIANTE.FUNCIONES F
     WHERE F.${colSala} = :sid
       AND TRUNC(F.FECHA) = TRUNC(:dayStart)
  `;
  const binds = { sid: Number(salaId), dayStart };
  try { return (await conn.execute(base('SALA_ID'), binds)).rows || []; }
  catch (e) { if (!String(e.message).includes('ORA-00904')) throw e; }
  try { return (await conn.execute(base('ID_SALA'), binds)).rows || []; }
  catch (e) { if (!String(e.message).includes('ORA-00904')) throw e; }
  try { return (await conn.execute(base('SALA'), binds)).rows || []; }
  catch (e) { throw e; }
}

/* -------- EVENTOS por día (para slots) -------- */
async function _fetchEventosDiaSala(conn, salaId, dayStart) {
  const base = (colSala) => `
    SELECT START_TS, END_TS, NVL(ESTADO,'RESERVADO') AS ESTADO
      FROM ESTUDIANTE.EVENTOS_ESPECIALES E
     WHERE E.${colSala} = :sid
       AND UPPER(TRIM(NVL(E.ESTADO,'RESERVADO'))) <> 'CANCELADO'
       AND TRUNC(E.START_TS) = TRUNC(:dayStart)
  `;
  const binds = { sid: Number(salaId), dayStart };
  try { return (await conn.execute(base('SALA_ID'), binds)).rows || []; }
  catch (e) { if (!String(e.message).includes('ORA-00904')) throw e; }
  try { return (await conn.execute(base('ID_SALA'), binds)).rows || []; }
  catch (e) { if (!String(e.message).includes('ORA-00904')) throw e; }
  try { return (await conn.execute(base('SALA'), binds)).rows || []; }
  catch (e) { throw e; }
}

/* -------- EVENTOS por solape (para validar disponibilidad/crear) -------- */
async function _fetchEventosSolape(conn, salaId, startTs, endTs) {
  const base = (colSala) => `
    SELECT START_TS, END_TS, NVL(ESTADO,'RESERVADO') AS ESTADO
      FROM ESTUDIANTE.EVENTOS_ESPECIALES E
     WHERE E.${colSala} = :sid
       AND UPPER(TRIM(NVL(E.ESTADO,'RESERVADO'))) <> 'CANCELADO'
       AND NOT (E.END_TS <= :startTs OR E.START_TS >= :endTs)
  `;
  const binds = { sid: Number(salaId), startTs, endTs };
  try { return (await conn.execute(base('SALA_ID'), binds)).rows || []; }
  catch (e) { if (!String(e.message).includes('ORA-00904')) throw e; }
  try { return (await conn.execute(base('ID_SALA'), binds)).rows || []; }
  catch (e) { if (!String(e.message).includes('ORA-00904')) throw e; }
  try { return (await conn.execute(base('SALA'), binds)).rows || []; }
  catch (e) { throw e; }
}

/* ========= Contadores para disponibilidad/crear ======== */
async function contarSolapeFunciones(conn, { salaId, startTs, endTs }) {
  const sMin = startTs.getHours() * 60 + startTs.getMinutes();
  const eMin = endTs.getHours() * 60 + endTs.getMinutes();
  const rows = await _fetchFuncionesDiaSala(conn, salaId, startOfDay(startTs));
  let cnt = 0;
  for (const r of rows) {
    const est = String(r.ESTADO || '').toUpperCase();
    if (est.startsWith('CANCEL')) continue;
    const ini = parseHoraMin(r.HORA_INICIO ?? r.hora_inicio);
    const fin = parseHoraMin(r.HORA_FINAL  ?? r.hora_final);
    if (Number.isFinite(ini) && Number.isFinite(fin)) {
      if (!(fin <= sMin || ini >= eMin)) cnt++;
    }
  }
  return cnt;
}
async function contarSolapeEventos(conn, { salaId, startTs, endTs }) {
  const rows = await _fetchEventosSolape(conn, salaId, startTs, endTs);
  return rows.length;
}

/* ================== 1) DISPONIBILIDAD ================== */
async function disponibilidad(req, res) {
  const { salaId, fecha, horaInicio, duracionMin } = req.query;
  if (!salaId || !fecha || !horaInicio || !duracionMin) {
    return res.status(400).json({ message: 'salaId, fecha, horaInicio y duracionMin son obligatorios.' });
  }

  const startTs = parseLocalDateTime(fecha, horaInicio);
  const endTs   = new Date(startTs.getTime() + Number(duracionMin) * 60 * 1000);

  let conn;
  try {
    conn = await getConnection();
    const params = { salaId: Number(salaId), startTs, endTs };

    const cntFunc = await contarSolapeFunciones(conn, params);
    if (cntFunc > 0) return res.json({ disponible: false, reason: 'funcion' });

    const cntEvt = await contarSolapeEventos(conn, params);
    if (cntEvt > 0) return res.json({ disponible: false, reason: 'evento' });

    const eventDay = startOfDay(startTs);
    const minDay = startOfDay(new Date()); minDay.setDate(minDay.getDate() + 3);
    if (eventDay < minDay) return res.json({ disponible: false, reason: 'min3dias', minDay: ymd(minDay) });

    return res.json({ disponible: true });
  } catch (e) {
    console.error('disponibilidad eventos error:', e);
    return res.status(500).json({ message: 'Error al verificar disponibilidad', detail: e.message ?? String(e) });
  } finally {
    try { await conn?.close(); } catch {}
  }
}

/* ================== 2) CREAR ================== */
async function crearEventoReservado(req, res) {
  const { salaId, fecha, horaInicio, duracionMin, personas, notas, clienteId, email } = req.body;
  if (!salaId || !fecha || !horaInicio || !duracionMin) {
    return res.status(400).json({ message: 'salaId, fecha, horaInicio y duracionMin son obligatorios.' });
  }

  const startTs = parseLocalDateTime(fecha, horaInicio);
  const endTs   = new Date(startTs.getTime() + Number(duracionMin) * 60 * 1000);

  const emailTrim   = String(email || '').trim();
  const notasDB     = emailTrim ? `${notas || ''} [UEMAIL:${emailTrim}]` : (notas || null);
  const clienteIdDB = clienteId ? Number(clienteId) : null;

  let conn;
  try {
    conn = await getConnection();

    const params = { salaId: Number(salaId), startTs, endTs };
    if (await contarSolapeFunciones(conn, params))
      return res.status(409).json({ message: 'La sala ya tiene una función en ese horario.' });
    if (await contarSolapeEventos(conn, params))
      return res.status(409).json({ message: 'La sala ya está reservada para un evento en ese horario.' });

    const eventDay = startOfDay(startTs);
    const minDay = startOfDay(new Date()); minDay.setDate(minDay.getDate() + 3);
    if (eventDay < minDay)
      return res.status(400).json({ message: 'Debes reservar con mínimo 3 días de anticipación.', minDay: ymd(minDay) });

    // Insert con RETURNING (captura ID aunque lo asigne un trigger)
    const result = await conn.execute(
      `INSERT INTO ESTUDIANTE.EVENTOS_ESPECIALES
         (SALA_ID, START_TS, END_TS, DURACION_MIN, PERSONAS, NOTAS, ESTADO, CLIENTE_ID)
       VALUES
         (:salaId, :startTs, :endTs, :duracionMin, :personas, :notas, 'RESERVADO', :clienteId)
       RETURNING ID_EVENTO INTO :outId`,
      {
        salaId: Number(salaId),
        startTs,
        endTs,
        duracionMin: Number(duracionMin),
        personas: personas ? Number(personas) : null,
        notas: notasDB,
        clienteId: clienteIdDB,
        outId: { dir: oracledb.BIND_OUT, type: oracledb.NUMBER }
      },
      { autoCommit: true }
    );

    const newId =
      (result.outBinds && result.outBinds.outId && result.outBinds.outId[0]) ?
      Number(result.outBinds.outId[0]) : null;

    const pagoLimite = ymd(new Date(eventDay.getTime() - 24 * 3600 * 1000));
    return res.json({ ok: true, pagoLimite, id: newId });
  } catch (e) {
    console.error('crearEventoReservado error:', e);
    return res.status(500).json({ message: 'No se pudo crear la reserva', detail: String(e) });
  } finally {
    try { await conn?.close(); } catch {}
  }
}

/* ================== 3) LISTAR (ADMIN / HISTORIAL) ================== */
async function listarEventosReservados(req, res) {
  const showAll = String(req.query.all || '').trim() === '1';
  const { fecha } = req.query;

  // mantiene compatibilidad: si viene context=dashboard, ocultamos siempre
  const context = String(req.query.context || '').toLowerCase();
  if (context === 'dashboard') return res.json([]);

  let conn;

  const base = (salaIdCol = 'ID', where = '', order = 'ORDER BY E.CREATED_AT DESC NULLS LAST') => `
    SELECT
           E.ID_EVENTO                                        AS ID_EVENTO,
           E.ID_EVENTO                                        AS "idEvento",
           E.SALA_ID                                          AS SALA_ID,
           E.SALA_ID                                          AS "salaId",
           S.NOMBRE                                           AS SALA_NOMBRE,
           S.NOMBRE                                           AS "salaNombre",
           E.START_TS                                         AS START_TS,
           E.END_TS                                           AS END_TS,
           TO_CHAR(E.START_TS,'HH24:MI')                      AS "horaInicio",
           TO_CHAR(E.END_TS,'HH24:MI')                        AS "horaFinal",
           TO_CHAR(E.START_TS,'YYYY-MM-DD')                   AS "fecha",
           E.DURACION_MIN                                     AS DURACION_MIN,
           E.DURACION_MIN                                     AS "duracionMin",
           E.PERSONAS                                         AS PERSONAS,
           E.PERSONAS                                         AS "personas",
           E.NOTAS                                            AS NOTAS,
           E.NOTAS                                            AS "notas",
           NVL(E.ESTADO,'RESERVADO')                          AS ESTADO,
           NVL(E.ESTADO,'RESERVADO')                          AS "estado",
           E.CLIENTE_ID                                       AS CLIENTE_ID,
           E.CLIENTE_ID                                       AS "clienteId",
           E.CREATED_AT                                       AS CREATED_AT
      FROM ESTUDIANTE.EVENTOS_ESPECIALES E
 LEFT JOIN ESTUDIANTE.SALAS S
        ON S.${salaIdCol} = E.SALA_ID
     ${where}
     ${order}`;

  try {
    conn = await getConnection();

    // Auto-finalizar vencidos
    await conn.execute(
      `UPDATE ESTUDIANTE.EVENTOS_ESPECIALES E
          SET E.ESTADO = 'FINALIZADO'
        WHERE E.END_TS <= SYSTIMESTAMP
          AND UPPER(TRIM(NVL(E.ESTADO,'RESERVADO'))) = 'RESERVADO'`,
      {},
      { autoCommit: true }
    );

    // ✅ NUEVA LÓGICA: si NO hay fecha y NO se pidió all=1, no devolvemos nada
    if (!fecha && !showAll) {
      return res.json([]);
    }

    if (fecha) {
      let dayStart;
      try { dayStart = parseInputDate(fecha); }
      catch { return res.status(400).json({ message: 'Formato de fecha inválido. Usa YYYY-MM-DD o DD/MM/YYYY.' }); }
      const dayEnd = new Date(dayStart.getFullYear(), dayStart.getMonth(), dayStart.getDate() + 1);

      const whereDia = `WHERE E.START_TS >= :dayStart AND E.START_TS < :dayEnd`;
      const orderDia = `ORDER BY E.START_TS ASC`;
      const binds = { dayStart, dayEnd };

      try {
        const r = await conn.execute(base('ID', whereDia, orderDia), binds);
        return res.json(r.rows || []);
      } catch (e1) {
        if (String(e1.message).includes('ORA-00904')) {
          const r2 = await conn.execute(base('ID_SALA', whereDia, orderDia), binds);
          return res.json(r2.rows || []);
        }
        throw e1;
      }
    }

    // aquí solo entra cuando showAll=1
    const whereAllOrReserved = `WHERE 1=1`;
    try {
      const r = await conn.execute(base('ID', whereAllOrReserved), {});
      return res.json(r.rows || []);
    } catch (e1) {
      if (String(e1.message).includes('ORA-00904')) {
        const r2 = await conn.execute(base('ID_SALA', whereAllOrReserved), {});
        return res.json(r2.rows || []);
      }
      throw e1;
    }
  } catch (e) {
    console.error('listarEventosReservados error:', e);
    return res.status(500).json({ message: 'Error al listar eventos', detail: e.message ?? String(e) });
  } finally {
    try { await conn?.close(); } catch {}
  }
}

/* ================== 3.1) LISTAR MIS RESERVAS (CLIENTE) ================== */
async function listarMisEventos(req, res) {
  let conn;
  try {
    conn = await getConnection();

    const clienteId = req.query.clienteId ? Number(req.query.clienteId) : null;
    const emailRaw  = String(req.query.email || '').trim();
    const email     = emailRaw || null;

    if (!clienteId && !email) {
      return res.status(400).json({ message: 'Falta clienteId o email.' });
    }

    // Helper local para el botón "Cancelar"
    const canCancelFrom = (iso, estado) => {
      const start = iso ? new Date(iso) : null;
      if (!start || isNaN(start)) return false;
      const now = new Date();
      const diffMs = start.getTime() - now.getTime();
      const H24 = 24 * 60 * 60 * 1000;
      const estadoOk = !['CANCELADO','FINALIZADO'].includes(String(estado || '').toUpperCase());
      return diffMs >= H24 && estadoOk;
    };

    // ¿Existe la tabla de pagos? (para flag pagado)
    const hasPagoTbl = (await tableExists(conn, 'POS_PAGO_EVENTO'));
    const pagoExistsSQL = hasPagoTbl
      ? `CASE WHEN EXISTS (
             SELECT 1
               FROM ESTUDIANTE.POS_PAGO_EVENTO p
              WHERE p.EVENTO_ID = E.ID_EVENTO
                AND NVL(UPPER(p.ESTADO),'X') IN ('PAGADO','CONFIRMADO')
           ) THEN 1 ELSE 0 END AS "pagadoFlag"`
      : `0 AS "pagadoFlag"`;

    const binds = {};
    const conds = [];
    if (clienteId) { conds.push('E.CLIENTE_ID = :clienteId'); binds.clienteId = clienteId; }
    if (email)     { conds.push('INSTR(UPPER(NVL(E.NOTAS,\'\')), :tag) > 0'); binds.tag = `[UEMAIL:${email.toUpperCase()}]`; }
    const where = `WHERE ${conds.join(' OR ')}`;

    // SELECT base con fallback (SALAS.ID o SALAS.ID_SALA)
    const base = (salaIdCol = 'ID') => `
      SELECT
        E.ID_EVENTO                                     AS "idEvento",
        E.SALA_ID                                       AS "salaId",
        S.NOMBRE                                        AS "salaNombre",

        /* ISO y crudos */
        TO_CHAR(E.START_TS,'YYYY-MM-DD"T"HH24:MI:SS')   AS "inicioISO",
        TO_CHAR(E.END_TS,'YYYY-MM-DD"T"HH24:MI:SS')     AS "finISO",
        TO_CHAR(E.START_TS,'YYYY-MM-DD')                AS "fecha",
        TO_CHAR(E.START_TS,'HH24:MI')                   AS "horaInicio",
        TO_CHAR(E.END_TS,'HH24:MI')                     AS "horaFin",

        /* Listo para UI (12h + dd/mm/yyyy) */
        TO_CHAR(E.START_TS,'DD/MM/YYYY')                AS "fechaTxt",
        TO_CHAR(E.START_TS,'HH12:MI AM')                AS "horaInicioTxt",
        TO_CHAR(E.END_TS,'HH12:MI AM')                  AS "horaFinTxt",

        /* Otros campos */
        E.DURACION_MIN                                  AS "duracionMin",
        E.PERSONAS                                      AS "personas",
        E.NOTAS                                         AS "notas",
        NVL(E.ESTADO,'RESERVADO')                       AS "estado",
        E.CLIENTE_ID                                    AS "clienteId",
        ${pagoExistsSQL}
      FROM ESTUDIANTE.EVENTOS_ESPECIALES E
      LEFT JOIN ESTUDIANTE.SALAS S
             ON S.${salaIdCol} = E.SALA_ID
      ${where}
      ORDER BY E.START_TS DESC`;

    let rows;
    try {
      rows = (await conn.execute(base('ID'), binds)).rows || [];
    } catch (e1) {
      if (!String(e1.message).includes('ORA-00904')) throw e1;
      rows = (await conn.execute(base('ID_SALA'), binds)).rows || [];
    }

    // Normalizamos: camelCase + legacy + objeto sala
    const data = rows.map(r => {
      const salaId     = Number(r.salaId) || null;
      const salaNombre = (r.salaNombre && String(r.salaNombre).trim())
                          || (salaId ? `Sala ${salaId}` : 'Sala');
      const inicioISO  = r.inicioISO || null;
      const finISO     = r.finISO || null;
      const pagadoBool = r.pagadoFlag === 1;

      return {
        // ==== camelCase (principal) ====
        id: r.idEvento,
        salaId,
        salaNombre,
        fecha: r.fecha || null,          // YYYY-MM-DD
        horaInicio: r.horaInicio || null,
        horaFin: r.horaFin || null,
        inicioISO,
        finISO,
        fechaTxt: r.fechaTxt,            // dd/mm/yyyy
        horaInicioTxt: r.horaInicioTxt,  // HH:MM AM/PM
        horaFinTxt: r.horaFinTxt,
        duracionMin: r.duracionMin ?? null,
        personas: r.personas ?? null,
        estado: r.estado,
        notas: r.notas || '',
        clienteId: r.clienteId ?? null,
        pagado: pagadoBool,
        puedeCancelar: canCancelFrom(inicioISO, r.estado),

        // ==== legacy (compatibilidad total con JSX viejo) ====
        ID_EVENTO: r.idEvento,
        SALA_ID: salaId,
        SALA_NOMBRE: salaNombre,
        FECHA: r.fecha || null,
        HORA_INICIO: r.horaInicio || null,
        HORA_FIN: r.horaFin || null,
        START_ISO: inicioISO,
        END_ISO: finISO,
        FECHA_TXT: r.fechaTxt,
        HORA_INICIO_TXT: r.horaInicioTxt,
        HORA_FIN_TXT: r.horaFinTxt,
        DURACION_MIN: r.duracionMin ?? null,
        PERSONAS: r.personas ?? null,
        ESTADO: r.estado,
        NOTAS: r.notas || '',
        CLIENTE_ID: r.clienteId ?? null,
        PAGADO: pagadoBool ? 1 : 0,

        // ==== objeto anidado sala ====
        sala: { id: salaId, nombre: salaNombre },
      };
    });

    return res.json(data);
  } catch (e) {
    console.error('listarMisEventos error:', e);
    return res.status(500).json({ message: 'Error al listar mis reservas', detail: e.message ?? String(e) });
  } finally {
    try { await conn?.close(); } catch {}
  }
}

/* ================== 4) ACTUALIZAR ================== */
async function actualizarEventoReservado(req, res) {
  const { id } = req.params;
  const { salaId, fecha, horaInicio, duracionMin, personas, notas, estado } = req.body;
  if (!id) return res.status(400).json({ message: 'id requerido' });

  let startTs = null, endTs = null;
  if (fecha && horaInicio && duracionMin) {
    const s = parseLocalDateTime(fecha, horaInicio);
    startTs = s;
    endTs = new Date(s.getTime() + Number(duracionMin) * 60 * 1000);
  }

  let conn;
  try {
    conn = await getConnection();
    await conn.execute(
      `UPDATE ESTUDIANTE.EVENTOS_ESPECIALES
          SET
            SALA_ID      = COALESCE(:salaId, SALA_ID),
            START_TS     = COALESCE(:startTs, START_TS),
            END_TS       = COALESCE(:endTs, END_TS),
            DURACION_MIN = COALESCE(:duracionMin, DURACION_MIN),
            PERSONAS     = COALESCE(:personas, PERSONAS),
            NOTAS        = COALESCE(:notas, NOTAS),
            ESTADO       = COALESCE(:estado, ESTADO)
        WHERE ID_EVENTO   = :id`,
      {
        id: Number(id),
        salaId: salaId ? Number(salaId) : null,
        startTs,
        endTs,
        duracionMin: duracionMin ? Number(duracionMin) : null,
        personas: personas ? Number(personas) : null,
        notas: notas || null,
        estado: estado || null,
      },
      { autoCommit: true }
    );
    return res.json({ ok: true });
  } catch (e) {
    console.error('actualizarEventoReservado error:', e);
    return res.status(500).json({ message: 'No se pudo actualizar el evento', detail: e.message ?? String(e) });
  } finally {
    try { await conn?.close(); } catch {}
  }
}

/* ================== 5) CANCELAR ================== */
async function getPagoTableName(conn) {
  const qUser = await conn.execute(
    `SELECT COUNT(*) N FROM USER_TABLES WHERE TABLE_NAME='POS_PAGO_EVENTO'`
  );
  const qAll = await conn.execute(
    `SELECT COUNT(*) N FROM ALL_TABLES WHERE OWNER='ESTUDIANTE' AND TABLE_NAME='POS_PAGO_EVENTO'`
  );
  const hasUser = (qUser.rows?.[0]?.N || qUser.rows?.[0]?.n || 0) > 0;
  const hasEst  = (qAll.rows?.[0]?.N  || qAll.rows?.[0]?.n  || 0) > 0;
  if (hasUser) return 'POS_PAGO_EVENTO';
  if (hasEst)  return 'ESTUDIANTE.POS_PAGO_EVENTO';
  return null;
}

async function cancelarEventoReservado(req, res) {
  const { id } = req.params;
  if (!id) return res.status(400).json({ message: 'id requerido' });

  let conn;
  try {
    conn = await getConnection();

    const info = await conn.execute(
      `SELECT ID_EVENTO, START_TS, NVL(ESTADO,'RESERVADO') AS ESTADO
         FROM ESTUDIANTE.EVENTOS_ESPECIALES
        WHERE ID_EVENTO = :id`,
      { id: Number(id) }
    );
    const row = info.rows?.[0];
    if (!row) return res.status(404).json({ message: 'Evento no encontrado' });

    const now = new Date();
    const startTs = row.START_TS instanceof Date ? row.START_TS : new Date(row.START_TS);
    if (!Number.isNaN(startTs) && (startTs.getTime() - now.getTime()) <= 24 * 3600 * 1000) {
      return res.status(400).json({ message: 'Faltan menos de 24 h; ya no puede cancelarse.' });
    }

    const pagoTable = await getPagoTableName(conn);
    if (pagoTable) {
      const pagos = await conn.execute(
        `SELECT COUNT(*) N
           FROM ${pagoTable} P
          WHERE P.EVENTO_ID = :id
            AND NVL(UPPER(P.ESTADO),'X') IN ('PAGADO','CONFIRMADO')`,
        { id: Number(id) }
      );
      const n = pagos.rows?.[0]?.N || pagos.rows?.[0]?.n || 0;
      if (n > 0) {
        return res.status(400).json({ message: 'La reserva ya está pagada y no puede cancelarse.' });
      }
    }

    try {
      await conn.execute(`BEGIN ESTUDIANTE.PR_EVT_CANCELAR(:id); END;`, { id: Number(id) }, { autoCommit: true });
      return res.json({ ok: true, via: 'SP' });
    } catch {
      await conn.execute(
        `UPDATE ESTUDIANTE.EVENTOS_ESPECIALES
            SET ESTADO = 'CANCELADO'
          WHERE ID_EVENTO = :id`,
        { id: Number(id) },
        { autoCommit: true }
      );
      return res.json({ ok: true, via: 'UPDATE' });
    }
  } catch (e) {
    console.error('cancelarEventoReservado error:', e);
    return res.status(500).json({ message: 'No se pudo cancelar el evento', detail: e.message ?? String(e) });
  } finally {
    try { await conn?.close(); } catch {}
  }
}

/* ================== 6) SLOTS DISPONIBLES ================== */
async function obtenerSlots(req, res) {
  const { salaId, fecha, duracionMin = '120', open = '10:00', close = '22:00', stepMin = '30' } = req.query;
  if (!salaId || !fecha) return res.status(400).json({ message: 'salaId y fecha son obligatorios.' });

  const salaNum = Number(salaId);

  let dayStart;
  try { dayStart = parseInputDate(fecha); }
  catch { return res.status(400).json({ message: 'Formato de fecha inválido. Usa YYYY-MM-DD o DD/MM/YYYY.' }); }
  const y = dayStart.getFullYear(), m = dayStart.getMonth() + 1, d = dayStart.getDate();

  const dur  = Math.max(1, Number(duracionMin) || 120);
  const step = Math.max(1, Number(stepMin)     || 30);
  const [oh, om] = open.split(':').map(Number);
  const [ch, cm] = close.split(':').map(Number);
  const openMin  = oh*60 + (om || 0);
  const closeMin = ch*60 + (cm || 0);
  const toHM = (mins) => `${pad2(Math.floor(mins/60))}:${pad2(mins%60)}`;
  const roundDown = (mins) => Math.floor(mins/step)*step;
  const roundUp   = (mins) => Math.ceil(mins/step)*step;

  const minDay = startOfDay(new Date()); minDay.setDate(minDay.getDate() + 3);
  const allowReserve = startOfDay(dayStart) >= minDay;

  let conn;
  try {
    conn = await getConnection();

    const funRows = await _fetchFuncionesDiaSala(conn, salaNum, dayStart);
    const evtRows = await _fetchEventosDiaSala(conn, salaNum, dayStart);

    const funMin = [];
    for (const r of funRows) {
      const est = String(r.ESTADO || '').toUpperCase();
      if (est.startsWith('CANCEL')) continue;
      const ini = parseHoraMin(r.HORA_INICIO ?? r.hora_inicio);
      const fin = parseHoraMin(r.HORA_FINAL  ?? r.hora_final);
      if (Number.isFinite(ini) && Number.isFinite(fin)) funMin.push({ ini, fin, tipo: 'funcion' });
    }

    const evtMin = [];
    for (const e of evtRows) {
      const s = (e.START_TS instanceof Date) ? e.START_TS : new Date(e.START_TS);
      const t = (e.END_TS   instanceof Date) ? e.END_TS   : new Date(e.END_TS);
      if (Number.isNaN(s) || Number.isNaN(t)) continue;
      evtMin.push({ ini: s.getHours()*60 + s.getMinutes(), fin: t.getHours()*60 + t.getMinutes(), tipo: 'evento' });
    }

    const ocupadosMin = [];
    for (const f of funMin) {
      const s = Math.max(openMin, Math.floor(iniRound(f.ini, 30)));
      const e = Math.min(closeMin, Math.ceil(iniRound(f.fin, 30)));
      if (e > s) ocupadosMin.push({ ini: s, fin: e, tipo: f.tipo });
    }
    function iniRound(mins, step){ return mins/step*step; }

    for (const ev of evtMin) {
      const s = Math.max(openMin, Math.floor(ev.ini/30)*30);
      const e = Math.min(closeMin, Math.ceil(ev.fin/30)*30);
      if (e > s) ocupadosMin.push({ ini: s, fin: e, tipo: ev.tipo });
    }
    ocupadosMin.sort((a,b) => a.ini - b.ini);
    const merged = [];
    for (const r of ocupadosMin) {
      if (!merged.length || r.ini > merged[merged.length - 1].fin) merged.push({ ...r });
      else merged[merged.length - 1].fin = Math.max(merged[merged.length - 1].fin, r.fin);
    }

    const starts = [];
    for (let s = openMin; s +  (Number(duracionMin)||120) <= closeMin; s += 30) {
      const e = s + (Number(duracionMin)||120);
      const overlap = merged.some(b => s < b.fin && e > b.ini);
      if (!overlap) starts.push(s);
    }

    return res.json({
      salaId: salaNum,
      fecha: `${y}-${pad2(m)}-${pad2(d)}`,
      open, close,
      stepMin: 30,
      duracionMin: Number(duracionMin)||120,
      allowReserve,
      minDay: ymd(minDay),
      disponibles: starts.map(m => `${pad2(Math.floor(m/60))}:${pad2(m%60)}`),
      ocupados: merged.map(r => ({ start: `${pad2(Math.floor(r.ini/60))}:${pad2(r.ini%60)}`, end: `${pad2(Math.floor(r.fin/60))}:${pad2(r.fin%60)}`, tipo: r.tipo })),
    });
  } catch (e) {
    console.error('obtenerSlots error:', e);
    return res.status(500).json({ message: 'No se pudieron calcular los horarios', detail: e?.message || String(e) });
  } finally {
    try { await conn?.close(); } catch {}
  }
}

/* ================== 7) PDF COMPROBANTE ================== */
async function comprobantePdfEvento(req, res) {
  const id = Number(req.params.id || 0);
  if (!id) return res.status(400).json({ message: 'ID inválido' });

  let conn;
  try {
    conn = await getConnection();

    let row;
    try {
      const r1 = await conn.execute(
        `SELECT E.ID_EVENTO,
                E.SALA_ID,
                E.START_TS, E.END_TS, E.DURACION_MIN,
                E.PERSONAS, E.NOTAS, NVL(E.ESTADO,'RESERVADO') AS ESTADO,
                S.NOMBRE AS SALA_NOMBRE
           FROM ESTUDIANTE.EVENTOS_ESPECIALES E
      LEFT JOIN ESTUDIANTE.SALAS S ON S.ID_SALA = E.SALA_ID
          WHERE E.ID_EVENTO = :id`,
        { id }
      );
      row = r1.rows?.[0];
    } catch (e1) {
      if (!String(e1.message).includes('ORA-00904')) throw e1;
      const r2 = await conn.execute(
        `SELECT E.ID_EVENTO,
                E.SALA_ID,
                E.START_TS, E.END_TS, E.DURACION_MIN,
                E.PERSONAS, E.NOTAS, NVL(E.ESTADO,'RESERVADO') AS ESTADO,
                S.NOMBRE AS SALA_NOMBRE
           FROM ESTUDIANTE.EVENTOS_ESPECIALES E
      LEFT JOIN ESTUDIANTE.SALAS S ON S.ID = E.SALA_ID
          WHERE E.ID_EVENTO = :id`,
        { id }
      );
      row = r2.rows?.[0];
    }

    if (!row) return res.status(404).json({ message: 'Evento no encontrado' });

    const start = row.START_TS instanceof Date ? row.START_TS : new Date(row.START_TS);
    const end   = row.END_TS   instanceof Date ? row.END_TS   : new Date(row.END_TS);
    const fechaTexto = `${pad2(start.getDate())}/${pad2(start.getMonth()+1)}/${start.getFullYear()}`;
    const horaIni = hm(start);
    const horaFin = hm(end);

    res.setHeader('Content-Type', 'application/pdf');
    res.setHeader('Content-Disposition', `inline; filename="Reserva-${row.ID_EVENTO}.pdf"`);

    const doc = new PDFDocument({ size: 'A4', margin: 48 });
    doc.pipe(res);

    doc.fontSize(18).text('Comprobante de Reserva', { align: 'center' });
    doc.moveDown(0.2).fontSize(10).fillColor('#555')
       .text(`No. de reserva: ${row.ID_EVENTO}`, { align: 'center' })
       .fillColor('black').moveDown(1);

    doc.fontSize(12)
       .text(`Sala: ${row.SALA_NOMBRE || row.SALA_ID}`)
       .moveDown(0.2)
       .text(`Fecha: ${fechaTexto}`)
       .moveDown(0.2)
       .text(`Horario: ${horaIni} — ${horaFin} (${row.DURACION_MIN || '-'} min)`)
       .moveDown(0.2)
       .text(`Personas: ${row.PERSONAS ?? '-'}`)
       .moveDown(0.2)
       .text(`Estado: ${row.ESTADO}`)
       .moveDown(0.8);

    if (row.NOTAS) {
      doc.fontSize(12).text('Notas', { underline: true }).moveDown(0.3);
      doc.fontSize(11).text(String(row.NOTAS), { width: 500 });
      doc.moveDown(0.8);
    }

    doc.fontSize(10).fillColor('#555')
       .text('Forma de pago: Efectivo')
       .text('Este comprobante confirma la reserva del horario. El pago se registra en Caja.')
       .fillColor('black');

    const gen = new Date();
    const genTxt = `${pad2(gen.getDate())}/${pad2(gen.getMonth()+1)}/${pad2(gen.getFullYear())} ${hm(gen)}`;
    doc.moveDown(2).fontSize(9).fillColor('#777')
       .text(`Generado: ${genTxt}`, { align: 'right' });

    doc.end();
  } catch (e) {
    console.error('comprobantePdfEvento error:', e);
    return res.status(500).json({ message: 'Error al generar PDF' });
  } finally {
    try { await conn?.close(); } catch {}
  }
}

module.exports = {
  disponibilidad,
  crearEventoReservado,
  listarEventosReservados,
  listarMisEventos,
  actualizarEventoReservado,
  cancelarEventoReservado,
  obtenerSlots,
  comprobantePdfEvento,
};
