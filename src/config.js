import crypto from 'node:crypto';

export const isProduction = process.env.NODE_ENV === 'production';

const unsafeValues = new Set([
  '',
  'dev_secret_change_me',
  'TrueLeadAdmin123!',
  'development-only-change-this-secret',
  'development-webhook-secret',
  'development-encryption-key-change-me',
  'changeme'
]);

function assertStrong(name, value, minLength = 24) {
  const normalized = String(value || '').trim();
  if (!normalized || normalized.length < minLength || unsafeValues.has(normalized)) {
    throw new Error(`${name} debe configurarse con un secreto aleatorio de al menos ${minLength} caracteres.`);
  }
}

export function validateRuntimeConfig() {
  if (!isProduction) return;

  assertStrong('JWT_SECRET', process.env.JWT_SECRET, 32);
  assertStrong('ADMIN_PASSWORD', process.env.ADMIN_PASSWORD, 12);
  assertStrong('DATA_ENCRYPTION_KEY', process.env.DATA_ENCRYPTION_KEY, 32);

  // El webhook genérico es una integración opcional. Si no se configura, su
  // ruta responde 503 y el resto de TrueLead puede iniciar normalmente.
  // Si sí se configura, no aceptamos secretos débiles en producción.
  if (String(process.env.WHATSAPP_WEBHOOK_SECRET || '').trim()) {
    assertStrong('WHATSAPP_WEBHOOK_SECRET', process.env.WHATSAPP_WEBHOOK_SECRET, 24);
  }

  const cloudWebhookValues = [process.env.META_APP_SECRET, process.env.META_WHATSAPP_VERIFY_TOKEN];
  if (cloudWebhookValues.some(Boolean)) {
    assertStrong('META_APP_SECRET', process.env.META_APP_SECRET, 16);
    assertStrong('META_WHATSAPP_VERIFY_TOKEN', process.env.META_WHATSAPP_VERIFY_TOKEN, 24);
  }

  if (String(process.env.WHATSAPP_ALLOW_DEMO_CONNECT || 'false') !== 'false') {
    throw new Error('WHATSAPP_ALLOW_DEMO_CONNECT debe ser false en producción.');
  }

  let appUrl;
  try {
    appUrl = new URL(String(process.env.APP_URL || ''));
  } catch {
    throw new Error('APP_URL debe ser una URL HTTPS válida en producción.');
  }
  if (appUrl.protocol !== 'https:') {
    throw new Error('APP_URL debe usar HTTPS en producción.');
  }
  if (process.env.COOKIE_DOMAIN && !/^\.?[a-z0-9.-]+$/i.test(process.env.COOKIE_DOMAIN)) {
    throw new Error('COOKIE_DOMAIN contiene un valor inválido.');
  }

  const allowedOrigins = String(process.env.CORS_ORIGIN || '')
    .split(',')
    .map((value) => value.trim())
    .filter(Boolean);
  if (!allowedOrigins.length || allowedOrigins.includes('*')) {
    throw new Error('CORS_ORIGIN debe enumerar dominios confiables y no puede ser * en producción.');
  }
  for (const origin of allowedOrigins) {
    try {
      const url = new URL(origin);
      if (url.protocol !== 'https:' || url.origin !== origin) throw new Error('invalid');
    } catch {
      throw new Error(`CORS_ORIGIN contiene un origen inválido o no HTTPS: ${origin}`);
    }
  }
}

export function randomToken(bytes = 32) {
  return crypto.randomBytes(bytes).toString('base64url');
}
