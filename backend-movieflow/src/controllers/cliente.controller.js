// src/controllers/cliente.controller.js
const oracledb = require('oracledb');
const db = require('../config/db');
const crypto = require('crypto');

const OUT_OBJ = { outFormat: oracledb.OUT_FORMAT_OBJECT };

// Correo: nombre del remitente se configura en services/mailer.js vía .env (SENDGRID_FROM_NAME)
const { sendPurchaseEmail, sendReservationEmail } = require('../services/mailer');

// PDF de tickets (buffer) – lo crearás tú en src/services/ticketsPdf.js
const { buildTicketsPdfBufferByCompra } = require('../services/ticketsPdf');

/* ------------------------- Helpers ------------------------- */

// --- Helper: obtiene datos descriptivos para el correo ---
async function getInfoCompra(cn, compraId) {
  // Película/función/sala
  const r = await cn.execute(
    `
    SELECT
      p.TITULO AS "pelicula",
      TO_CHAR(f.FECHA,'YYYY-MM-DD') AS "fecha",
      TO_CHAR(f.FECHA + f.HORA_INICIO,'HH24:MI') AS "hora",
      s.NOMBRE AS "sala"
    FROM COMPRAS c
    JOIN FUNCIONES f ON f.ID_FUNCION = c.ID_FUNCION
    JOIN PELICULA  p ON p.ID_PELICULA = f.ID_PELICULA
    JOIN SALAS     s ON s.ID_SALA     = f.ID_SALA
    WHERE c.ID_COMPRA = :id
    `,
    { id: Number(compraId) },
    OUT_OBJ
  );
  const head = r.rows?.[0] || { pelicula:'', fecha:'', hora:'', sala:'' };

  // Asientos en formato FILA+COL
  const ra = await cn.execute(
    `
    SELECT a.FILA || a.COLUMNA AS "label"
    FROM ENTRADAS e
    JOIN FUNCION_ASIENTO fa ON fa.ID_FA = e.ID_FA
    JOIN ASIENTOS a ON a.ID_ASIENTO = fa.ID_ASIENTO
    WHERE e.ID_COMPRA = :id
    ORDER BY a.FILA, a.COLUMNA
    `,
    { id: Number(compraId) },
    OUT_OBJ
  );
  const asientos = (ra.rows || []).map(x => x.label);

  return { ...head, asientos };
}

// (opcional) ofuscación determinística del googleId si la quisieras usar
function hmacSub(googleId) {
  return crypto
    .createHmac('sha256', process.env.JWT_SECRET || 'secret')
    .update(String(googleId))
    .digest('hex');
}

// Obtiene o crea el CLIENTE a partir del token decodificado
async function upsertCliente(cn, decoded) {
  // decoded proviene del middleware: { googleId, email, name, ... }
  if (!decoded?.googleId) throw new Error('Token sin googleId');

  // Usa una sola: googleId “plano” o hmac(googleId)
  const providerSub = decoded.googleId; // o hmacSub(decoded.googleId)
  const provider = 'google';

  // ¿Existe?
  const r1 = await cn.execute(
    `SELECT ID_CLIENTE AS "id" 
       FROM CLIENTES 
      WHERE PROVIDER = :prov AND PROVIDER_SUB = :sub`,
    { prov: provider, sub: providerSub },
    OUT_OBJ
  );
  if (r1.rows?.[0]?.id) return Number(r1.rows[0].id);

  // Crear
  const r2 = await cn.execute(
    `INSERT INTO CLIENTES(
       PROVIDER, PROVIDER_SUB, EMAIL, NOMBRE, FECHA_CREACION, ULTIMO_INGRESO
     ) VALUES (
       :prov, :sub, :email, :nombre, SYSTIMESTAMP, SYSTIMESTAMP
     )
     RETURNING ID_CLIENTE INTO :id`,
    {
      prov: provider,
      sub: providerSub,
      email: decoded.email || null,
      nombre: decoded.name || null,
      id: { dir: oracledb.BIND_OUT, type: oracledb.NUMBER },
    },
    { autoCommit: false }
  );
  return Number(r2.outBinds.id[0]);
}

// Precio de una función
async function getFuncionPrecio(cn, funcionId) {
  const r = await cn.execute(
    `SELECT PRECIO AS "precio" FROM FUNCIONES WHERE ID_FUNCION = :id`,
    { id: Number(funcionId) },
    OUT_OBJ
  );
  return r.rows?.[0]?.precio ? Number(r.rows[0].precio) : 0;
}

// Idempotencia: recuperar compra por idemKey
async function getCompraByIdemKey(cn, idemKey) {
  if (!idemKey) return null;

  const r = await cn.execute(
    `SELECT ID_COMPRA, ID_CLIENTE, ID_FUNCION, MONTO_TOTAL, ESTADO, METODO_PAGO, IDEMPOTENCY_KEY
       FROM COMPRAS 
      WHERE IDEMPOTENCY_KEY = :k`,
    { k: idemKey },
    OUT_OBJ
  );
  if (!r.rows || !r.rows[0]) return null;

  const comp = r.rows[0];
  const re = await cn.execute(
    `SELECT ID_ENTRADA, ID_FA, PRECIO, ESTADO, CODIGO_QR
       FROM ENTRADAS 
      WHERE ID_COMPRA = :c`,
    { c: comp.ID_COMPRA },
    OUT_OBJ
  );
  return {
    compraId: Number(comp.ID_COMPRA),
    idCliente: Number(comp.ID_CLIENTE),
    funcionId: Number(comp.ID_FUNCION),
    total: Number(comp.MONTO_TOTAL || 0),
    estado: comp.ESTADO,
    metodoPago: comp.METODO_PAGO,
    idemKey: comp.IDEMPOTENCY_KEY,
    entradas: (re.rows || []).map((E) => ({
      idEntrada: Number(E.ID_ENTRADA),
      idFa: Number(E.ID_FA),
      precio: Number(E.PRECIO || 0),
      estado: E.ESTADO,
      codigoQR: E.CODIGO_QR || null,
    })),
  };
}

/* ------------------------- Consultas de cliente ------------------------- */

// Cartelera con idioma y clasificación
exports.getCartelera = async (req, res) => {
  let cn;
  try {
    cn = await db.getConnection();

    const sql = `
      SELECT
        p.ID_PELICULA                      AS id,
        p.TITULO                           AS titulo,
        p.DURACION_MINUTOS                 AS duracionMin,
        p.ESTADO                           AS estado,
        cat.NOMBRE                         AS categoriaNombre,
        idi.NOMBRE                         AS idioma,
        cla.NOMBRE                         AS clasificacion,
        CASE WHEN p.IMAGEN_URL IS NULL THEN NULL
             ELSE DBMS_LOB.SUBSTR(p.IMAGEN_URL, 4000, 1) END AS imagenUrl
      FROM PELICULA p
      LEFT JOIN CATEGORIAS     cat ON cat.ID_CATEGORIA     = p.ID_CATEGORIA
      LEFT JOIN IDIOMAS        idi ON idi.ID_IDIOMA        = p.ID_IDIOMA
      LEFT JOIN CLASIFICACION  cla ON cla.ID_CLASIFICACION = p.ID_CLASIFICACION
      WHERE p.ESTADO = 'ACTIVA'
      ORDER BY p.TITULO ASC
    `;
    const r = await cn.execute(sql, {}, OUT_OBJ);
    const rows = (r.rows || []).map((R) => ({
      id: R.id ?? R.ID,
      titulo: R.titulo ?? R.TITULO,
      duracionMin: R.duracionMin ?? R.DURACIONMIN,
      estado: R.estado ?? R.ESTADO,
      categoriaNombre: R.categoriaNombre ?? R.CATEGORIANOMBRE,
      idioma: R.idioma ?? R.IDIOMA,
      clasificacion: R.clasificacion ?? R.CLASIFICACION,
      imagenUrl: String(R.imagenUrl ?? R.IMAGENURL ?? '').replace(/\\/g, '/'),
    }));

    res.json(rows);
  } catch (e) {
    console.error('GET /api/cliente/cartelera ->', e);
    res.status(500).json({ message: 'Error al obtener cartelera' });
  } finally {
    try { if (cn) await cn.close(); } catch {}
  }
};

// Funciones por película
exports.getFuncionesByPelicula = async (req, res) => {
  let cn;
  try {
    const { peliculaId } = req.params;
    const { fecha } = req.query;

    cn = await db.getConnection();

    const where = [`f.ESTADO = 'ACTIVA'`, `f.ID_PELICULA = :peliculaId`];
    const bind = { peliculaId: Number(peliculaId) };

    if ((fecha || '').trim()) {
      where.push(`f.FECHA = TO_DATE(:fecha,'YYYY-MM-DD')`);
      bind.fecha = fecha.trim();
    }

    const sql = `
      SELECT
        f.ID_FUNCION AS "id",
        f.ID_PELICULA AS "peliculaId",
        f.ID_SALA     AS "salaId",
        TO_CHAR(f.FECHA,'YYYY-MM-DD') AS "fecha",
        TO_CHAR(f.FECHA + f.HORA_INICIO,'HH24:MI') AS "horaInicio",
        TO_CHAR(
          f.FECHA + f.HORA_FINAL
          + CASE WHEN f.HORA_FINAL <= f.HORA_INICIO
                 THEN NUMTODSINTERVAL(1,'DAY')
                 ELSE NUMTODSINTERVAL(0,'DAY') END,
          'HH24:MI'
        ) AS "horaFinal",
        f.PRECIO     AS "precio",
        s.NOMBRE     AS "salaNombre",
        frm.NOMBRE   AS "formato",

        /* ---- contadores ---- */
        (SELECT COUNT(*) FROM FUNCION_ASIENTO fa
          WHERE fa.ID_FUNCION = f.ID_FUNCION) AS "totalSeats",
        (SELECT COUNT(*) FROM FUNCION_ASIENTO fa
          WHERE fa.ID_FUNCION = f.ID_FUNCION AND fa.ESTADO = 'VENDIDO') AS "vendidos",
        (SELECT COUNT(*) FROM FUNCION_ASIENTO fa
          WHERE fa.ID_FUNCION = f.ID_FUNCION AND fa.ESTADO = 'RESERVADO') AS "reservados",
        (SELECT COUNT(*) FROM FUNCION_ASIENTO fa
          WHERE fa.ID_FUNCION = f.ID_FUNCION
            AND (fa.ESTADO='DISPONIBLE'
                 OR (fa.ESTADO='BLOQUEADO' AND (fa.BLOQUEADO_HASTA IS NULL OR fa.BLOQUEADO_HASTA <= SYSTIMESTAMP))
            )
        ) AS "disponibles"
      FROM FUNCIONES f
      JOIN SALAS s      ON s.ID_SALA      = f.ID_SALA
      LEFT JOIN FORMATO frm ON frm.ID_FORMATO = f.ID_FORMATO
      WHERE ${where.join(' AND ')}
      ORDER BY f.FECHA, f.ID_SALA, f.HORA_INICIO
    `;

    const r = await cn.execute(sql, bind, OUT_OBJ);
    res.json(r.rows || []);
  } catch (e) {
    console.error('GET /api/cliente/cartelera/:peliculaId/funciones ->', e);
    res.status(500).json({ message: 'Error al obtener funciones' });
  } finally {
    try { if (cn) await cn.close(); } catch {}
  }
};

// Asientos de una función
exports.getAsientosByFuncion = async (req, res) => {
  let cn;
  try {
    const { funcionId } = req.params;
    cn = await db.getConnection();

    const r = await cn.execute(
      `
      SELECT
        fa.ID_FA          AS "idFa",
        a.FILA            AS "fila",
        a.COLUMNA         AS "columna",
        a.TIPO            AS "tipo",
        fa.ESTADO         AS "estado",
        fa.BLOQUEADO_HASTA AS "bloqueado_hasta"
      FROM FUNCION_ASIENTO fa
      JOIN ASIENTOS a ON a.ID_ASIENTO = fa.ID_ASIENTO
      WHERE fa.ID_FUNCION = :id
      ORDER BY a.FILA, a.COLUMNA
      `,
      { id: Number(funcionId) },
      OUT_OBJ
    );

    res.json(r.rows || []);
  } catch (e) {
    console.error('GET /api/cliente/funciones/:funcionId/asientos ->', e);
    res.status(500).json({ message: 'Error al obtener asientos' });
  } finally {
    try { if (cn) await cn.close(); } catch {}
  }
};

/* ------------------------- Acciones (pago / reserva) ------------------------- */

// Pagar: marca VENDIDO, crea COMPRAS + ENTRADAS
exports.postPagar = async (req, res) => {
  let cn;
  try {
    const { funcionId } = req.params;
    const { asientos = [], metodo, idemKey } = req.body;
    const decoded = req.cliente;

    if (!decoded?.googleId) return res.status(401).json({ message: 'No autenticado' });
    if (!Array.isArray(asientos) || asientos.length === 0) {
      return res.status(400).json({ message: 'Debes enviar asientos[]' });
    }
    const metodoUp = String(metodo || '').toUpperCase();
    if (!['TARJETA', 'PAYPAL'].includes(metodoUp)) {
      return res.status(400).json({ message: 'Método inválido' });
    }

    cn = await db.getConnection();
    await cn.execute(`BEGIN NULL; END;`); // inicio transacción

    // Idempotencia (si ya existe, regresamos eso)
    if (idemKey) {
      const prev = await getCompraByIdemKey(cn, idemKey);
      if (prev) return res.json({ ok: true, idempotent: true, ...prev });
    }

    const idCliente = await upsertCliente(cn, decoded);
    const precioUnit = await getFuncionPrecio(cn, funcionId);
    const total = precioUnit * asientos.length;

    // Vender asientos (simple: ESTADO -> VENDIDO, limpia bloqueos)
    const bindsUpd = { funcionId: Number(funcionId) };
    const inKeys = asientos.map((id, i) => ((bindsUpd[`id${i}`] = Number(id)), `:id${i}`));
    const upd = await cn.execute(
      `UPDATE FUNCION_ASIENTO
          SET ESTADO='VENDIDO', BLOQUEADO_HASTA=NULL
        WHERE ID_FUNCION=:funcionId 
          AND ID_FA IN (${inKeys.join(',')}) 
          AND ESTADO <> 'VENDIDO'`,
      bindsUpd,
      { autoCommit: false }
    );
    if ((upd.rowsAffected || 0) < asientos.length) {
      await cn.rollback();
      return res.status(409).json({ message: 'Alguno de los asientos ya no está disponible.' });
    }

    // COMPRAS (PAGADA)
    const rComp = await cn.execute(
      `INSERT INTO COMPRAS(
         ID_CLIENTE, ID_FUNCION, MONTO_TOTAL, ESTADO, METODO_PAGO, IDEMPOTENCY_KEY
       ) VALUES (
         :cli, :fun, :tot, 'PAGADA', :met, :idem
       ) RETURNING ID_COMPRA INTO :id`,
      {
        cli: idCliente,
        fun: Number(funcionId),
        tot: total,
        met: metodoUp,
        idem: idemKey || null,
        id: { dir: oracledb.BIND_OUT, type: oracledb.NUMBER },
      },
      { autoCommit: false }
    );
    const compraId = Number(rComp.outBinds.id[0]);

    // ENTRADAS (EMITIDA) + QR
    for (const idFa of asientos) {
      await cn.execute(
        `INSERT INTO ENTRADAS(
           ID_COMPRA, ID_FA, PRECIO, ESTADO, CODIGO_QR
         ) VALUES (
           :c, :fa, :p, 'EMITIDA', :qr
         )`,
        { c: compraId, fa: Number(idFa), p: precioUnit, qr: crypto.randomUUID() },
        { autoCommit: false }
      );
    }

    await cn.commit();

    // ---- Envío de correo con PDF adjunto (no bloqueante) ----
    try {
      // 1) Construir PDF (una página por entrada EMITIDA)
      const pdfBuf = await buildTicketsPdfBufferByCompra(cn, compraId);
      const attachments = pdfBuf ? [{
        content: pdfBuf.toString('base64'),
        filename: `tickets_${compraId}.pdf`,
        type: 'application/pdf',
        disposition: 'attachment'
      }] : [];

      // 2) Info para el cuerpo
      const info = await getInfoCompra(cn, compraId);

      // 3) Enviar correo
      await sendPurchaseEmail({
        to: decoded.email,               // viene del token de cliente
        nombre: decoded.name || null,
        pelicula: info.pelicula,
        fecha: info.fecha,
        hora: info.hora,
        sala: info.sala,
        asientos: info.asientos,
        total,
        compraId,
        attachments,                     // 👈 adjuntamos el PDF
      });
    } catch (mailErr) {
      console.warn('Email compra falló (no bloquea):', mailErr?.message || mailErr);
    }

    // Respuesta HTTP
    res.json({
      ok: true,
      compraId,
      idCliente,
      funcionId: Number(funcionId),
      total,
      estado: 'PAGADA',
      metodoPago: metodoUp,
    });
  } catch (e) {
    try { if (cn) await cn.rollback(); } catch {}
    console.error('POST /pagar ->', e);
    res.status(500).json({ message: e?.message || 'Error al confirmar pago' });
  } finally {
    try { if (cn) await cn.close(); } catch {}
  }
};

// Reservar: marca RESERVADO hasta 1h antes del inicio
exports.postReservar = async (req, res) => {
  let cn;
  try {
    const { funcionId } = req.params;
    const { asientos = [], idemKey, numeroReserva } = req.body;
    const decoded = req.cliente;

    if (!decoded?.googleId) return res.status(401).json({ message: 'No autenticado' });
    if (!Array.isArray(asientos) || asientos.length === 0) {
      return res.status(400).json({ message: 'Debes enviar asientos[]' });
    }

    cn = await db.getConnection();
    await cn.execute(`BEGIN NULL; END;`);

    if (idemKey) {
      const prev = await getCompraByIdemKey(cn, idemKey);
      if (prev) return res.json({ ok: true, idempotent: true, ...prev });
    }

    // ---- Identificar cliente ya (lo usamos en las validaciones) ----
    const idCliente = await upsertCliente(cn, decoded);

    // ---- 1) Cierre de reservas 1 hora antes ----
    const rClose = await cn.execute(
      `SELECT CASE
                 WHEN SYSTIMESTAMP >= (FECHA + HORA_INICIO - NUMTODSINTERVAL(1,'HOUR'))
                 THEN 1 ELSE 0 END AS "cerrada"
          FROM FUNCIONES WHERE ID_FUNCION=:id`,
      { id: Number(funcionId) }, OUT_OBJ
    );
    if (rClose.rows?.[0]?.cerrada === 1) {
      await cn.rollback();
      return res.status(400).json({ message: 'Las reservas se cierran 1 hora antes del inicio de la función.' });
    }

    // ---- 2) Máximo 5 por cliente/función ----
    const rCount = await cn.execute(
      `SELECT COUNT(*) AS "n"
          FROM ENTRADAS e
          JOIN COMPRAS c ON c.ID_COMPRA = e.ID_COMPRA
         WHERE c.ID_CLIENTE = :cli
           AND c.ID_FUNCION = :fun
           AND e.ESTADO = 'RESERVADA'`,
      { cli: idCliente, fun: Number(funcionId) }, OUT_OBJ
    );
    const yaReservados = Number(rCount.rows?.[0]?.n || 0);
    if (yaReservados + asientos.length > 5) {
      await cn.rollback();
      return res.status(400).json({ message: 'Límite de 5 asientos reservados por función.' });
    }

    const expiraSql = `(SELECT (FECHA + HORA_INICIO - NUMTODSINTERVAL(1,'HOUR')) 
                         FROM FUNCIONES WHERE ID_FUNCION=:funcionId)`;

    const bindsUpd = { funcionId: Number(funcionId) };
    const inKeys = asientos.map((id, i) => ((bindsUpd[`id${i}`] = Number(id)), `:id${i}`));
    const upd = await cn.execute(
      `UPDATE FUNCION_ASIENTO fa
          SET fa.ESTADO='RESERVADO',
              fa.BLOQUEADO_HASTA=${expiraSql}
        WHERE fa.ID_FUNCION=:funcionId
          AND fa.ID_FA IN (${inKeys.join(',')})
          AND (fa.ESTADO='DISPONIBLE' 
               OR (fa.ESTADO='BLOQUEADO' AND fa.BLOQUEADO_HASTA < SYSTIMESTAMP))`,
      bindsUpd,
      { autoCommit: false }
    );
    if ((upd.rowsAffected || 0) < asientos.length) {
      await cn.rollback();
      return res.status(409).json({ message: 'Alguno de los asientos ya no está disponible para reservar.' });
    }

    const precioUnit = await getFuncionPrecio(cn, funcionId);
    const total = precioUnit * asientos.length;

    const rComp = await cn.execute(
      `INSERT INTO COMPRAS(
         ID_CLIENTE, ID_FUNCION, MONTO_TOTAL, ESTADO, METODO_PAGO, IDEMPOTENCY_KEY
       ) VALUES (
         :cli, :fun, :tot, 'PENDIENTE', 'EFECTIVO', :idem
       ) RETURNING ID_COMPRA INTO :id`,
      {
        cli: idCliente,
        fun: Number(funcionId),
        tot: total,
        idem: idemKey || null,
        id: { dir: oracledb.BIND_OUT, type: oracledb.NUMBER },
      },
      { autoCommit: false }
    );
    const compraId = Number(rComp.outBinds.id[0]);

    // ENTRADAS (RESERVADA) sin QR
    for (const idFa of asientos) {
      await cn.execute(
        `INSERT INTO ENTRADAS(
           ID_COMPRA, ID_FA, PRECIO, ESTADO, CODIGO_QR
         ) VALUES (
           :c, :fa, :p, 'RESERVADA', NULL
         )`,
        { c: compraId, fa: Number(idFa), p: precioUnit },
        { autoCommit: false }
      );
    }

    // Guarda una fila por asiento en RESERVA_ASIENTO (numeroReserva obligatorio)
    if (!numeroReserva) {
      await cn.rollback();
      return res.status(400).json({ message: 'Falta numeroReserva' });
    }
    for (const idFa of asientos) {
      await cn.execute(
        `INSERT INTO RESERVA_ASIENTO (NUMERO_RESERVA, ID_FA, CREADO_EN, CREADO_POR, ESTADO)
         VALUES (:num, :fa, SYSTIMESTAMP, :creadoPor, 'PENDIENTE')`,
        { num: Number(numeroReserva), fa: Number(idFa), creadoPor: (decoded.email || 'cliente') },
        { autoCommit: false }
      );
    }

    await cn.commit();

    // ---- Envío de correo de reserva (sin adjuntos) ----
    try {
      const info = await getInfoCompra(cn, compraId);
      await sendReservationEmail({
        to: decoded.email,
        nombre: decoded.name || null,
        pelicula: info.pelicula,
        fecha: info.fecha,
        hora: info.hora,
        sala: info.sala,
        asientos: info.asientos,
        total,
        numeroReserva: Number(numeroReserva),
      });
    } catch (mailErr) {
      console.warn('Email reserva falló (no bloquea):', mailErr?.message || mailErr);
    }

    res.json({
      ok: true,
      compraId,
      idCliente,
      funcionId: Number(funcionId),
      total,
      estado: 'PENDIENTE',
      metodoPago: 'EFECTIVO',
      numeroReserva: Number(numeroReserva)
    });
  } catch (e) {
    try { if (cn) await cn.rollback(); } catch {}
    console.error('POST /reservar ->', e);
    res.status(500).json({ message: e?.message || 'Error al reservar asientos' });
  } finally {
    try { if (cn) await cn.close(); } catch {}
  }
};

// Liberar reservas caducadas
exports.postLiberarReservasVencidas = async (req, res) => {
  let cn;
  try {
    const { funcionId } = req.params;
    cn = await db.getConnection();

    const upd = await cn.execute(
      `
      UPDATE FUNCION_ASIENTO
         SET ESTADO = 'DISPONIBLE',
             BLOQUEADO_HASTA = NULL
       WHERE ID_FUNCION = :funcionId
         AND ESTADO = 'RESERVADO'
         AND BLOQUEADO_HASTA IS NOT NULL
         AND BLOQUEADO_HASTA <= SYSTIMESTAMP
      `,
      { funcionId: Number(funcionId) },
      { autoCommit: true }
    );

    res.json({ ok: true, released: upd.rowsAffected || 0 });
  } catch (e) {
    console.error('POST /api/cliente/funciones/:funcionId/liberar-reservas-vencidas ->', e);
    res.status(500).json({ message: 'Error al liberar reservas vencidas' });
  } finally {
    try { if (cn) await cn.close(); } catch {}
  }
};
