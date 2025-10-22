// src/services/mailer.js
const sgMail = require('@sendgrid/mail');

/* ================== Configuración de entorno ================== */
const RAW_KEY = process.env.SENDGRID_API_KEY || '';
const API_KEY = RAW_KEY.trim();
const FROM_EMAIL = (process.env.SENDGRID_FROM || 'no-reply@movieflow.local').trim();
const FROM_NAME  = (process.env.SENDGRID_FROM_NAME || 'MovieFlow').trim();
const REPLY_TO   = (process.env.SENDGRID_REPLY_TO || FROM_EMAIL).trim();

const FROM = FROM_NAME ? { email: FROM_EMAIL, name: FROM_NAME } : FROM_EMAIL;

if (!API_KEY) {
  console.warn('[mailer] SENDGRID_API_KEY no definido. El envío se omitirá en tiempo de ejecución.');
} else if (!API_KEY.startsWith('SG.')) {
  console.error('[mailer] SENDGRID_API_KEY inválida: debe iniciar con "SG."');
} else {
  sgMail.setApiKey(API_KEY);
}

/* ================== Plantillas HTML ================== */
function tplCompraHTML({ nombre, pelicula, fecha, hora, sala, asientos, total, compraId }) {
  const lista = (asientos || []).map(a => `<li><strong>${a}</strong></li>`).join('');
  return `
  <div style="font-family:Arial,Helvetica,sans-serif; line-height:1.5; color:#222">
    <h2>🎫 ¡Gracias por tu compra, ${nombre || 'cliente'}!</h2>
    <p>Estos son los detalles de tus tickets:</p>
    <ul>
      <li><b>Película:</b> ${pelicula}</li>
      <li><b>Fecha:</b> ${fecha}</li>
      <li><b>Hora:</b> ${hora}</li>
      <li><b>Sala:</b> ${sala}</li>
      <li><b>Cantidad:</b> ${(asientos || []).length}</li>
      <li><b>Total:</b> Q ${Number(total || 0).toFixed(2)}</li>
      <li><b>N° de compra:</b> ${compraId}</li>
    </ul>
    <h3>Asientos</h3>
    <ol>${lista}</ol>
    <p>Lleva este correo al cine. El personal puede validar tus entradas con el código interno de compra.</p>
    <p>¡Que disfrutes la función! 🍿</p>
  </div>`;
}

function tplReservaHTML({ nombre, pelicula, fecha, hora, sala, asientos, total, numeroReserva }) {
  const lista = (asientos || []).map(a => `<li><strong>${a}</strong></li>`).join('');
  return `
  <div style="font-family:Arial,Helvetica,sans-serif; line-height:1.5; color:#222">
    <h2>📝 Reserva confirmada, ${nombre || 'cliente'}</h2>
    <p>Has reservado los siguientes asientos (pago en taquilla):</p>
    <ul>
      <li><b>Película:</b> ${pelicula}</li>
      <li><b>Fecha:</b> ${fecha}</li>
      <li><b>Hora:</b> ${hora}</li>
      <li><b>Sala:</b> ${sala}</li>
      <li><b>Cantidad:</b> ${(asientos || []).length}</li>
      <li><b>Total a pagar en taquilla:</b> Q ${Number(total || 0).toFixed(2)}</li>
      <li><b>Número de reserva:</b> ${numeroReserva}</li>
    </ul>
    <h3>Asientos</h3>
    <ol>${lista}</ol>
    <p>Debes llegar con tiempo para completar el pago. Las reservas se cierran 1 hora antes del inicio de la función.</p>
    <p>¡Te esperamos! 🎥</p>
  </div>`;
}

/* ================== Envío ================== */
async function safeSend(msg) {
  // En desarrollo/local sin key válida: no romper el flujo
  if (!API_KEY || !API_KEY.startsWith('SG.')) return;
  await sgMail.send(msg);
}

/**
 * Enviar correo de compra (entradas emitidas)
 * Acepta attachments opcional (e.g., PDF de tickets)
 */
async function sendPurchaseEmail({
  to, nombre, pelicula, fecha, hora, sala, asientos, total, compraId, attachments = [],
}) {
  const msg = {
    to,
    from: FROM,
    replyTo: REPLY_TO,
    subject: `Tus tickets - ${pelicula} (${fecha} ${hora})`,
    html: tplCompraHTML({ nombre, pelicula, fecha, hora, sala, asientos, total, compraId }),
    attachments, // [{ content: base64, filename, type: 'application/pdf', disposition: 'attachment' }]
    // categories: ['movieflow', 'purchase'], // opcional (SendGrid analytics)
  };
  await safeSend(msg);
}

/**
 * Enviar correo de reserva (paga en taquilla)
 */
async function sendReservationEmail({
  to, nombre, pelicula, fecha, hora, sala, asientos, total, numeroReserva,
}) {
  const msg = {
    to,
    from: FROM,
    replyTo: REPLY_TO,
    subject: `Reserva confirmada #${numeroReserva} - ${pelicula} (${fecha} ${hora})`,
    html: tplReservaHTML({ nombre, pelicula, fecha, hora, sala, asientos, total, numeroReserva }),
    // categories: ['movieflow', 'reservation'],
  };
  await safeSend(msg);
}

module.exports = {
  sendPurchaseEmail,
  sendReservationEmail,
};
