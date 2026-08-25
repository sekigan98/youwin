import crypto from 'node:crypto';
import jwt from 'jsonwebtoken';
import { db } from '../lib/db.js';
import { parseCookies, setAuthCookies } from '../lib/httpCookies.js';
import { isAgencyExpired } from '../lib/pricing.js';
import { nowIso } from '../lib/utils.js';

function jwtSecret() {
  return process.env.JWT_SECRET || 'dev_secret_change_me';
}

function safeEqual(left, right) {
  const a = Buffer.from(String(left || ''));
  const b = Buffer.from(String(right || ''));
  return a.length === b.length && crypto.timingSafeEqual(a, b);
}

export function signToken(user) {
  return jwt.sign(
    {
      sub: user.id,
      agencyId: user.agencyId,
      role: user.role
    },
    jwtSecret(),
    { expiresIn: '30d', issuer: 'truelead', audience: 'truelead-web' }
  );
}

export function requireAuth(req, res, next) {
  const authorization = req.headers.authorization || '';
  const bearer = authorization.startsWith('Bearer ') ? authorization.slice(7) : '';
  const cookies = parseCookies(req.headers.cookie || '');
  const cookieToken = cookies.tl_session || '';
  const token = bearer || cookieToken;

  if (!token) return res.status(401).json({ error: 'No autenticado.' });

  try {
    req.auth = jwt.verify(token, jwtSecret(), {
      issuer: 'truelead',
      audience: 'truelead-web'
    });
    req.authTransport = bearer ? 'bearer' : 'cookie';

    const user = db.data.users.find((item) => item.id === req.auth.sub);
    if (!user || user.status === 'suspended') {
      return res.status(403).json({ error: 'La cuenta no está disponible.' });
    }
    req.currentUser = user;
    req.auth.agencyId = user.agencyId;
    req.auth.role = user.role;

    if (req.authTransport === 'bearer') setAuthCookies(res, token);

    if (req.authTransport === 'cookie' && !['GET', 'HEAD', 'OPTIONS'].includes(req.method)) {
      const csrfHeader = req.headers['x-csrf-token'];
      if (!csrfHeader || !cookies.tl_csrf || !safeEqual(csrfHeader, cookies.tl_csrf)) {
        return res.status(403).json({ error: 'La sesión de seguridad expiró. Actualizá la página e intentá nuevamente.' });
      }
    }

    return next();
  } catch {
    return res.status(401).json({ error: 'Sesión inválida o expirada.' });
  }
}

export async function requireActiveAgency(req, res, next) {
  const agency = db.data.agencies.find((item) => item.id === req.auth?.agencyId);
  if (!agency) return res.status(404).json({ error: 'Agencia no encontrada.' });
  req.agency = agency;
  if (req.auth?.role === 'admin') return next();

  if (isAgencyExpired(agency)) {
    if (agency.status !== 'expired' || agency.planStatus !== 'expired') {
      agency.status = 'expired';
      agency.planStatus = 'expired';
      agency.updatedAt = nowIso();
      await db.save();
    }
    req.entitlementExpired = true;
    if (['GET', 'HEAD', 'OPTIONS'].includes(req.method)) return next();
    return res.status(402).json({
      error: 'El plan venció. Podés consultar el panel, pero tenés que reactivarlo para modificar datos o usar integraciones.',
      code: 'PLAN_EXPIRED'
    });
  }

  if (agency.status !== 'active') {
    return res.status(403).json({
      error: agency.status === 'pending_email'
        ? 'La cuenta todavía no verificó su email.'
        : 'La cuenta está suspendida o pendiente de activación.'
    });
  }

  return next();
}

export function requireAdmin(req, res, next) {
  if (req.auth?.role !== 'admin') {
    return res.status(403).json({ error: 'Requiere permisos de administrador.' });
  }
  return next();
}
