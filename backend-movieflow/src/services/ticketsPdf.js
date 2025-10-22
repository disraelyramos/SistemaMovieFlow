// src/services/ticketsPdf.js
const PDFDocument = require('pdfkit');
const qrcode = require('qrcode');

// ---- helpers (mismos que usas en empleado) ----
const pad2 = n => String(n).padStart(2, '0');
const toDDMMYYYY = (iso) => {
  const d = new Date(iso);
  return Number.isNaN(d.getTime()) ? '—/—/———' : `${pad2(d.getDate())}/${pad2(d.getMonth()+1)}/${d.getFullYear()}`;
};
const normHora = (h) => (String(h||'').match(/(\d{1,2}:\d{2})/)||[])[1] || String(h||'—');

async function renderTicketCard(doc, meta, ent) {
  const W = doc.page.width, H = doc.page.height;
  const rojo = '#e53935', blanco = '#fff';
  const x = 12, y = 12, w = W - 24, h = H - 24;

  doc.save();
  doc.roundedRect(x, y, w, h, 14).fill(rojo);

  let yy = y + 24;
  const left = x + 20;
  doc.fill(blanco).font('Helvetica-Bold').fontSize(22).text('MovieFlow', left, yy, { width: w-40 });
  yy += 34;

  const label = (t, v, dx = 0) => {
    doc.font('Helvetica').fontSize(11).fill(blanco)
       .text(`${t}: ${v}`, left + dx, yy, { width: (w - 40) / 2 - 6 });
  };
  // Sala/Asiento
  label('SALA', meta.sala, 0);
  label('ASIENTO', `${ent.fila}${ent.col}`, (w - 40) / 2 + 12);
  yy += 18;
  // Fecha/Hora
  label('FECHA', toDDMMYYYY(meta.fecha), 0);
  label('HORA', normHora(meta.hora), (w - 40) / 2 + 12);
  yy += 18;
  // Precio
  doc.font('Helvetica').fontSize(11).fill(blanco)
     .text(`PRECIO: Q ${Number(ent.precio||0).toFixed(2)}`, left, yy, { width: w-40 });
  yy += 22;
  // Película
  doc.font('Helvetica-Bold').fontSize(12).fill(blanco)
     .text(`PELÍCULA: ${meta.pelicula}`, left, yy, { width: w-40 });
  yy += 28;

  const qrDataUrl = await qrcode.toDataURL(String(ent.qr || `ENTRADA:${ent.idEntrada}`), {
    errorCorrectionLevel: 'M', margin: 1, scale: 6,
  });
  const qrBuf = Buffer.from(qrDataUrl.replace(/^data:image\/png;base64,/, ''), 'base64');

  const espacioRestante = (y + h) - yy - 24;
  const qrSize = Math.min(200, Math.max(120, espacioRestante));
  const qrX = x + (w - qrSize) / 2;
  doc.image(qrBuf, qrX, yy, { width: qrSize, height: qrSize });

  doc.restore();
}

/**
 * Genera un PDF (buffer) con 1 página por entrada EMITIDA de una compra.
 * Requiere una conexión Oracle abierta (cn) y compraId.
 */
async function buildTicketsPdfBufferByCompra(cn, compraId) {
  // Meta (compra/función/sala/película)
  const metaQ = await cn.execute(`
    SELECT
      c.ID_COMPRA        AS "compraId",
      f.ID_FUNCION       AS "funcionId",
      p.TITULO           AS "pelicula",
      TO_CHAR(f.FECHA,'YYYY-MM-DD') AS "fecha",
      TO_CHAR(f.HORA_INICIO,'HH24:MI') AS "hora",
      s.NOMBRE           AS "sala"
    FROM COMPRAS c
    JOIN FUNCIONES f ON f.ID_FUNCION = c.ID_FUNCION
    JOIN PELICULA  p ON p.ID_PELICULA = f.ID_PELICULA
    JOIN SALAS     s ON s.ID_SALA     = f.ID_SALA
    WHERE c.ID_COMPRA = :c
  `, { c: Number(compraId) }, { outFormat: cn.OUT_FORMAT_OBJECT || cn.oracledb?.OUT_FORMAT_OBJECT });

  const entradasQ = await cn.execute(`
    SELECT
      e.ID_ENTRADA   AS "idEntrada",
      e.CODIGO_QR    AS "qr",
      e.PRECIO       AS "precio",
      a.FILA         AS "fila",
      a.COLUMNA      AS "col"
    FROM ENTRADAS e
    JOIN FUNCION_ASIENTO fa ON fa.ID_FA = e.ID_FA
    JOIN ASIENTOS a         ON a.ID_ASIENTO = fa.ID_ASIENTO
    WHERE e.ID_COMPRA = :c AND e.ESTADO = 'EMITIDA'
    ORDER BY a.FILA, a.COLUMNA
  `, { c: Number(compraId) }, { outFormat: cn.OUT_FORMAT_OBJECT || cn.oracledb?.OUT_FORMAT_OBJECT });

  const meta = metaQ.rows?.[0];
  const entradas = entradasQ.rows || [];
  if (!meta || entradas.length === 0) return null;

  // Stream a buffer
  const chunks = [];
  const doc = new PDFDocument({ size: [360, 640], margin: 0 });
  doc.on('data', ch => chunks.push(ch));
  const done = new Promise(resolve => doc.on('end', () => resolve(Buffer.concat(chunks))));

  for (let i = 0; i < entradas.length; i++) {
    if (i > 0) doc.addPage({ size: [360, 640], margin: 0 });
    await renderTicketCard(doc, meta, entradas[i]);
  }
  doc.end();
  return await done;
}

module.exports = { buildTicketsPdfBufferByCompra };
