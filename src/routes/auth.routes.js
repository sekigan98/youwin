import express from 'express';
import bcrypt from 'bcryptjs';
import { nanoid } from 'nanoid';
import { db } from '../lib/db.js';
import { cleanString, nowIso, addDays, sha256, sha256Exact } from '../lib/utils.js';
import { signToken, requireAuth } from '../middleware/auth.js';
import { sendVerificationEmail, sendWelcomeEmail } from '../services/email.service.js';
import { clearAuthCookies, setAuthCookies } from '../lib/httpCookies.js';

export const authRouter = express.Router();

function isValidEmail(value) {
  return /^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(String(value || ''));
}

function publicUser(user) {
  if (!user) return null;
  const { passwordHash, ...safe } = user;
  const agency = db.data.agencies.find((a) => a.id === user.agencyId);
  const publicAgency = agency ? {
    id: agency.id,
    name: agency.name,
    status: agency.status,
    plan: agency.plan,
    planStatus: agency.planStatus,
    activatedAt: agency.activatedAt,
    expiresAt: agency.expiresAt
  } : null;
  return { ...safe, agency: publicAgency };
}

function createVerificationToken({ userId, agencyId }) {
  db.data.emailVerificationTokens = db.data.emailVerificationTokens || [];
  const existing = db.data.emailVerificationTokens.filter((token) => token.userId === userId && !token.usedAt);
  for (const token of existing) token.revokedAt = nowIso();

  const token = nanoid(40);
  db.data.emailVerificationTokens.push({
    id: nanoid(12),
    tokenHash: sha256Exact(token),
    userId,
    agencyId,
    type: 'email_verification',
    usedAt: null,
    revokedAt: null,
    expiresAt: addDays(new Date(), 7),
    createdAt: nowIso()
  });
  return token;
}

authRouter.post('/register', async (req, res) => {
  const name = cleanString(req.body.name, 120);
  const email = cleanString(req.body.email, 180).toLowerCase();
  const password = String(req.body.password || '');
  const agencyName = cleanString(req.body.agencyName || req.body.name, 160);

  if (!name || !agencyName || !isValidEmail(email) || password.length < 10 || Buffer.byteLength(password) > 72) {
    return res.status(400).json({ error: 'Completá nombre, agencia, un email válido y una contraseña de 10 a 72 bytes.' });
  }

  if (db.data.users.some((u) => u.email === email)) {
    return res.status(409).json({ error: 'Ese email ya está registrado.' });
  }

  const agencyId = nanoid(12);
  const userId = nanoid(12);
  const passwordHash = await bcrypt.hash(password, 12);

  // bcrypt cede el event loop; repetimos el control para cerrar una carrera
  // entre dos registros simultáneos con el mismo email.
  if (db.data.users.some((u) => u.email === email)) {
    return res.status(409).json({ error: 'Ese email ya está registrado.' });
  }

  const agency = {
    id: agencyId,
    name: agencyName,
    status: 'pending_email',
    plan: 'free',
    planStatus: 'free_pending_email',
    createdAt: nowIso(),
    activatedAt: null,
    expiresAt: null,
    notes: 'Cuenta Free esperando verificación de email. Requiere pago de Starter o superior para activar medición real.'
  };

  const user = {
    id: userId,
    agencyId,
    name,
    email,
    passwordHash,
    role: 'agency',
    status: 'pending_email',
    emailVerifiedAt: null,
    createdAt: nowIso(),
    lastLoginAt: null
  };

  db.data.agencies.push(agency);
  db.data.users.push(user);
  db.data.payments.push({
    id: nanoid(12),
    agencyId,
    amount: 0,
    currency: 'ARS',
    plan: 'free',
    status: 'active',
    method: 'free',
    notes: 'Cuenta Free creada. Requiere Starter o superior para vincular WhatsApp y crear proyectos.',
    createdAt: nowIso(),
    updatedAt: nowIso()
  });

  const token = createVerificationToken({ userId, agencyId });
  await db.save();

  sendVerificationEmail({ agency, user, token }).catch((error) => {
    console.warn('[email] verification email failed:', error.message);
  });

  return res.status(201).json({
    ok: true,
    message: 'Cuenta creada. Te enviamos un email para activarla. Tu cuenta inicia en Free; para medir leads reales necesitás Starter o superior.',
    user: publicUser(user)
  });
});

authRouter.post('/resend-verification', async (req, res) => {
  const email = cleanString(req.body.email, 180).toLowerCase();
  const user = db.data.users.find((u) => u.email === email);
  const generic = { ok: true, message: 'Si la cuenta existe y está pendiente, enviaremos un nuevo email de activación.' };
  if (!user || user.emailVerifiedAt) return res.json(generic);

  const agency = db.data.agencies.find((a) => a.id === user.agencyId);
  const token = createVerificationToken({ userId: user.id, agencyId: user.agencyId });
  await db.save();

  await sendVerificationEmail({ agency, user, token });
  res.json(generic);
});

async function verifyEmail(req, res) {
  const tokenValue = cleanString(req.body?.token || req.query.token, 120);
  const incomingHash = sha256Exact(tokenValue);
  const legacyHash = sha256(tokenValue);
  const token = db.data.emailVerificationTokens?.find((item) =>
    (item.tokenHash === incomingHash || item.tokenHash === legacyHash || item.token === tokenValue) && !item.usedAt && !item.revokedAt
  );

  if (!token) return res.status(400).json({ error: 'Token inválido o ya utilizado.' });
  if (new Date(token.expiresAt).getTime() < Date.now()) {
    return res.status(400).json({ error: 'El link de activación expiró. Solicitá uno nuevo.' });
  }

  const user = db.data.users.find((u) => u.id === token.userId);
  const agency = db.data.agencies.find((a) => a.id === token.agencyId);
  if (!user || !agency) return res.status(404).json({ error: 'Cuenta no encontrada.' });

  token.usedAt = nowIso();
  user.status = 'active';
  user.emailVerifiedAt = user.emailVerifiedAt || nowIso();
  agency.status = 'active';
  agency.planStatus = 'free';
  agency.activatedAt = agency.activatedAt || nowIso();
  agency.expiresAt = agency.expiresAt || null;
  agency.notes = 'Cuenta Free activada automáticamente por verificación de email. Requiere pago de Starter o superior para usar proyectos, WhatsApp y SDK.';

  db.data.events.push({
    id: `ev_${Date.now()}_${Math.random().toString(36).slice(2)}`,
    agencyId: agency.id,
    type: 'email_verified',
    message: `Cuenta ${agency.name} activada por verificación de email.`,
    createdAt: nowIso()
  });

  await db.save();

  sendWelcomeEmail({ agency, user }).catch((error) => {
    console.warn('[email] welcome email failed:', error.message);
  });

  return res.json({ ok: true, message: 'Cuenta activada correctamente. Ya podés ingresar.', user: publicUser(user) });
}

authRouter.get('/verify-email', verifyEmail); // Compatibilidad con links anteriores.
authRouter.post('/verify-email', verifyEmail);

authRouter.post('/login', async (req, res) => {
  const email = cleanString(req.body.email, 180).toLowerCase();
  const password = String(req.body.password || '');

  if (!isValidEmail(email) || !password || Buffer.byteLength(password) > 200) {
    return res.status(401).json({ error: 'Email o contraseña incorrectos.' });
  }

  const user = db.data.users.find((u) => u.email === email);
  if (!user || !(await bcrypt.compare(password, user.passwordHash))) {
    return res.status(401).json({ error: 'Email o contraseña incorrectos.' });
  }

  if (user.status === 'suspended') {
    return res.status(403).json({ error: 'Tu cuenta está suspendida. Contactá soporte.' });
  }

  if (user.status === 'pending_email') {
    return res.status(403).json({ error: 'Tu cuenta todavía no está activa. Revisá tu email y tocá el botón de activación.' });
  }

  user.lastLoginAt = nowIso();
  await db.save();

  const token = signToken(user);
  setAuthCookies(res, token);

  return res.json({
    ok: true,
    user: publicUser(user)
  });
});

authRouter.get('/me', requireAuth, (req, res) => {
  const user = db.data.users.find((u) => u.id === req.auth.sub);
  return res.json({ user: publicUser(user) });
});

authRouter.post('/logout', (req, res) => {
  clearAuthCookies(res);
  return res.json({ ok: true });
});
