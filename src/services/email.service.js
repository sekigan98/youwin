import nodemailer from 'nodemailer';
import { nanoid } from 'nanoid';
import { db } from '../lib/db.js';
import { cleanString, nowIso } from '../lib/utils.js';

const APP_NAME = process.env.APP_NAME || 'TrueLead';
const CONTACT_EMAIL = process.env.TRUELEAD_CONTACT_EMAIL || process.env.ADMIN_EMAIL || 'trueleadsite@gmail.com';
const FROM_EMAIL = process.env.MAIL_FROM || process.env.SMTP_USER || CONTACT_EMAIL;
const APP_URL = (process.env.APP_URL || process.env.API_PUBLIC_URL || '').replace(/\/$/, '');

let cachedTransporter = null;

function escapeHtml(value) {
  return String(value ?? '').replace(/[&<>'"]/g, (char) => ({
    '&': '&amp;', '<': '&lt;', '>': '&gt;', "'": '&#39;', '"': '&quot;'
  })[char]);
}

function smtpReady() {
  return Boolean(process.env.SMTP_HOST && process.env.SMTP_USER && process.env.SMTP_PASS);
}

function getTransporter() {
  if (cachedTransporter) return cachedTransporter;
  if (!smtpReady()) return null;

  cachedTransporter = nodemailer.createTransport({
    host: process.env.SMTP_HOST,
    port: Number(process.env.SMTP_PORT || 465),
    secure: String(process.env.SMTP_SECURE ?? 'true') !== 'false',
    auth: {
      user: process.env.SMTP_USER,
      pass: process.env.SMTP_PASS
    }
  });

  return cachedTransporter;
}

function baseUrl() {
  return APP_URL || 'http://localhost:3000';
}

function button(label, href) {
  return `<a href="${escapeHtml(href)}" style="display:inline-block;background:linear-gradient(135deg,#2e7cff,#0f61ff);color:#fff;text-decoration:none;font-weight:800;padding:14px 20px;border-radius:14px;margin:18px 0;">${escapeHtml(label)}</a>`;
}

function htmlLayout({ title, preview, body }) {
  return `
  <div style="margin:0;padding:0;background:#030711;font-family:Inter,Arial,sans-serif;color:#f5f8ff;">
    <div style="display:none;opacity:0;max-height:0;overflow:hidden;">${escapeHtml(preview || title)}</div>
    <table role="presentation" width="100%" cellpadding="0" cellspacing="0" style="background:#030711;padding:28px 0;">
      <tr>
        <td align="center">
          <table role="presentation" width="100%" cellpadding="0" cellspacing="0" style="max-width:620px;background:#07101f;border:1px solid rgba(46,124,255,.22);border-radius:24px;overflow:hidden;box-shadow:0 24px 70px rgba(0,0,0,.45);">
            <tr>
              <td style="padding:28px 30px 12px;">
                <div style="font-size:13px;letter-spacing:.12em;text-transform:uppercase;color:#9fc1ff;font-weight:900;">TRUELEAD</div>
                <h1 style="margin:14px 0 8px;font-size:30px;line-height:1.05;color:#fff;">${escapeHtml(title)}</h1>
              </td>
            </tr>
            <tr>
              <td style="padding:0 30px 30px;color:#c5d3f4;font-size:16px;line-height:1.7;">
                ${body}
                <p style="margin-top:24px;color:#8da1ce;font-size:13px;">Si no esperabas este email, podés ignorarlo. Ante cualquier duda, escribinos a ${escapeHtml(CONTACT_EMAIL)}.</p>
              </td>
            </tr>
          </table>
        </td>
      </tr>
    </table>
  </div>`;
}

async function logEmail({ to, subject, type, status, error }) {
  try {
    db.data.emailLogs = db.data.emailLogs || [];
    db.data.emailLogs.push({
      id: nanoid(12),
      to,
      subject,
      type,
      status,
      error: error ? cleanString(error, 500) : '',
      createdAt: nowIso()
    });
    await db.save();
  } catch (logError) {
    console.warn('[email] log failed:', logError.message);
  }
}

export async function sendTrueLeadEmail({ to, subject, text, html, type = 'generic' }) {
  const finalTo = cleanString(to, 240).replace(/[\r\n]/g, '');
  const finalSubject = cleanString(subject, 180).replace(/[\r\n]/g, '');
  if (!finalTo || !finalSubject) return { skipped: true, reason: 'missing_to_or_subject' };

  const transporter = getTransporter();
  if (!transporter) {
    console.log(`[email:skipped] ${type} -> ${finalTo}: ${finalSubject}`);
    await logEmail({ to: finalTo, subject: finalSubject, type, status: 'skipped_missing_smtp' });
    return { skipped: true, reason: 'missing_smtp_config' };
  }

  try {
    const info = await transporter.sendMail({
      from: `${APP_NAME} <${FROM_EMAIL}>`,
      to: finalTo,
      subject: finalSubject,
      text,
      html
    });
    await logEmail({ to: finalTo, subject: finalSubject, type, status: 'sent' });
    return { ok: true, messageId: info.messageId };
  } catch (error) {
    console.error('[email:error]', error.message);
    await logEmail({ to: finalTo, subject: finalSubject, type, status: 'error', error: error.message });
    return { ok: false, error: error.message };
  }
}

function agencyUsers(agencyId) {
  return db.data.users.filter((user) => user.agencyId === agencyId && user.role !== 'admin');
}

export async function sendVerificationEmail({ agency, user, token }) {
  const verifyUrl = `${baseUrl()}/verify-email#token=${encodeURIComponent(token)}`;
  await sendTrueLeadEmail({
    to: user.email,
    type: 'email_verification',
    subject: 'Activá tu cuenta de TrueLead',
    text: `Hola ${user.name}, activá tu cuenta de TrueLead entrando acá: ${verifyUrl}`,
    html: htmlLayout({
      title: 'Activá tu cuenta de TrueLead',
      preview: 'Confirmá tu email y empezá a medir leads reales.',
      body: `<p>Hola <strong>${escapeHtml(user.name)}</strong>,</p>
        <p>Ya recibimos el registro de <strong>${escapeHtml(agency.name)}</strong>. Para empezar a usar el panel, confirmá tu email con el botón de abajo.</p>
        ${button('Activar mi cuenta', verifyUrl)}
        <p>Después de activar la cuenta vas a entrar en Free para conocer el panel. Para vincular WhatsApp por QR, crear proyectos y medir leads reales, activá Starter o superior.</p>
        <p style="color:#8da1ce;font-size:13px;word-break:break-all;">${escapeHtml(verifyUrl)}</p>`
    })
  });

  await sendTrueLeadEmail({
    to: CONTACT_EMAIL,
    type: 'registration_pending_admin',
    subject: `Nuevo registro en TrueLead: ${agency.name}`,
    text: `Nueva cuenta registrada. Agencia: ${agency.name}. Usuario: ${user.name}. Email: ${user.email}.`,
    html: htmlLayout({
      title: 'Nuevo registro en TrueLead',
      preview: `${agency.name} se registró en TrueLead.`,
      body: `<p>Se registró una nueva cuenta.</p><ul><li><strong>Agencia:</strong> ${escapeHtml(agency.name)}</li><li><strong>Usuario:</strong> ${escapeHtml(user.name)}</li><li><strong>Email:</strong> ${escapeHtml(user.email)}</li></ul><p>La cuenta queda esperando verificación de email y luego entra en Free automáticamente.</p>`
    })
  });
}

export async function sendWelcomeEmail({ agency, user }) {
  const appUrl = `${baseUrl()}/login`;
  return sendTrueLeadEmail({
    to: user.email,
    type: 'account_activated_free',
    subject: 'Tu cuenta TrueLead ya está activa',
    text: `Hola ${user.name}, tu cuenta ${agency.name} ya está activa. Entrá al panel: ${appUrl}`,
    html: htmlLayout({
      title: 'Tu cuenta ya está activa',
      preview: 'Tu panel Free ya está activo.',
      body: `<p>Hola <strong>${escapeHtml(user.name)}</strong>,</p><p>La cuenta <strong>${escapeHtml(agency.name)}</strong> ya está activa en plan Free.</p>${button('Entrar al panel', appUrl)}<p>Desde el panel vas a poder ver cómo funciona TrueLead. Para crear clientes, vincular WhatsApp por QR y medir leads reales, activá Starter o superior.</p>`
    })
  });
}

export async function notifyAgencyStatusChange({ agency, status }) {
  const recipients = agencyUsers(agency.id);
  const statusText = status === 'active' ? 'activa' : status === 'suspended' ? 'suspendida' : 'pendiente';
  await Promise.all(recipients.map((user) => sendTrueLeadEmail({
    to: user.email,
    type: 'agency_status_change',
    subject: `Tu cuenta TrueLead está ${statusText}`,
    text: `Hola ${user.name}, la cuenta ${agency.name} ahora está ${statusText}.`,
    html: htmlLayout({
      title: `Tu cuenta está ${statusText}`,
      body: `<p>Hola <strong>${escapeHtml(user.name)}</strong>,</p><p>La cuenta <strong>${escapeHtml(agency.name)}</strong> ahora está <strong>${escapeHtml(statusText)}</strong>.</p>`
    })
  })));
}

export async function notifyPaymentValidation({ agency, payment, status }) {
  const recipients = agencyUsers(agency.id);
  const statusText = status === 'approved' ? 'aprobado' : status === 'rejected' ? 'rechazado' : 'pendiente';
  await Promise.all(recipients.map((user) => sendTrueLeadEmail({
    to: user.email,
    type: 'payment_validation',
    subject: `Pago ${statusText} en TrueLead`,
    text: `Hola ${user.name}, el pago del plan ${payment.plan} por ${payment.currency} ${payment.amount} fue ${statusText}.`,
    html: htmlLayout({
      title: `Pago ${statusText}`,
      body: `<p>Hola <strong>${escapeHtml(user.name)}</strong>,</p><p>El pago del plan <strong>${escapeHtml(payment.plan)}</strong> por <strong>${escapeHtml(payment.currency)} ${escapeHtml(payment.amount)}</strong> fue <strong>${escapeHtml(statusText)}</strong>.</p>`
    })
  })));
}

export async function notifyPlanUpdated({ agency, plan, expiresAt }) {
  const recipients = agencyUsers(agency.id);
  await Promise.all(recipients.map((user) => sendTrueLeadEmail({
    to: user.email,
    type: 'plan_updated',
    subject: `Tu plan TrueLead ahora es ${plan.name}`,
    text: `Hola ${user.name}, tu cuenta ${agency.name} ahora tiene el plan ${plan.name}. Vencimiento: ${expiresAt || 'sin definir'}.`,
    html: htmlLayout({
      title: `Nuevo plan: ${plan.name}`,
      body: `<p>Hola <strong>${escapeHtml(user.name)}</strong>,</p><p>Tu cuenta <strong>${escapeHtml(agency.name)}</strong> ahora tiene el plan <strong>${escapeHtml(plan.name)}</strong>.</p><p>Vencimiento: <strong>${escapeHtml(expiresAt || 'sin definir')}</strong>.</p>`
    })
  })));
}
