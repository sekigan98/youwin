import 'dotenv/config';
import express from 'express';
import cors from 'cors';
import helmet from 'helmet';
import morgan from 'morgan';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { db } from './lib/db.js';
import { authRouter } from './routes/auth.routes.js';
import { agencyRouter } from './routes/agency.routes.js';
import { preleadRouter } from './routes/prelead.routes.js';
import { adminRouter } from './routes/admin.routes.js';
import { whatsappRouter } from './routes/whatsapp.routes.js';
import { landingBuilderRouter } from './routes/landingBuilder.routes.js';
import { whatsappManager } from './services/whatsappBaileys.service.js';
import { publicRouter } from './routes/public.routes.js';
import { isProduction, validateRuntimeConfig } from './config.js';
import { createRateLimit } from './middleware/rateLimit.js';
import { migrateEncryptedProjectSecrets } from './lib/secrets.js';
import { conversionQueue } from './services/conversionQueue.service.js';
import { wrapAsyncRouter } from './lib/asyncRoutes.js';

const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);
const rootDir = path.resolve(__dirname, '..');
const frontendDir = path.join(rootDir, 'frontend');

const app = express();
const port = Number(process.env.PORT || 3000);
app.set('trust proxy', 1);
validateRuntimeConfig();

const corsOrigins = (process.env.CORS_ORIGIN || process.env.APP_URL || 'http://localhost:3000')
  .split(',')
  .map((v) => v.trim())
  .filter(Boolean);

function isAllowedOrigin(origin) {
  if (!origin) return true;
  if (corsOrigins.includes('*') || corsOrigins.includes(origin)) return true;
  return false;
}

function isPublicEmbedPath(req) {
  return (
    req.path === '/api/preleads' ||
    req.path.startsWith('/api/public') ||
    req.path.startsWith('/sdk/')
  );
}

/*
  TrueLead se usa embebido en landings externas.
  Helmet por defecto agrega Cross-Origin-Resource-Policy: same-origin, lo que bloquea
  <script src="https://app.truelead.com.ar/sdk/truelead.js"> desde otra landing.
  Por eso mantenemos same-origin como valor general y lo cambiamos a cross-origin
  exclusivamente en /sdk/*.
*/
app.use(helmet({
  contentSecurityPolicy: {
    directives: {
      defaultSrc: ["'self'"],
      scriptSrc: ["'self'"],
      styleSrc: ["'self'", "'unsafe-inline'", 'https://fonts.googleapis.com'],
      fontSrc: ["'self'", 'https://fonts.gstatic.com'],
      imgSrc: ["'self'", 'data:'],
      connectSrc: ["'self'", 'https://app.truelead.com.ar'],
      objectSrc: ["'none'"],
      frameAncestors: ["'none'"],
      baseUri: ["'self'"],
      formAction: ["'self'"],
      upgradeInsecureRequests: isProduction ? [] : null
    }
  },
  crossOriginResourcePolicy: { policy: 'same-origin' }
}));

app.use((req, res, next) => {
  if (req.path.startsWith('/sdk/')) {
    res.setHeader('Access-Control-Allow-Origin', '*');
    res.setHeader('Cross-Origin-Resource-Policy', 'cross-origin');
    res.setHeader('Cross-Origin-Embedder-Policy', 'unsafe-none');
    res.setHeader('X-TrueLead-SDK', 'public');
  }
  next();
});

/*
  - Panel/app/admin: solo orígenes permitidos en CORS_ORIGIN.
  - SDK/preleads/pricing: deben poder ser llamados desde landings externas.
*/
app.use(cors((req, callback) => {
  const origin = req.header('Origin');
  const isPublic = isPublicEmbedPath(req);
  const allowed = isPublic || isAllowedOrigin(origin);

  callback(null, {
    origin: allowed ? (origin || true) : false,
    credentials: !isPublic,
    methods: ['GET', 'POST', 'PUT', 'PATCH', 'DELETE', 'OPTIONS'],
    allowedHeaders: ['Content-Type', 'Authorization', 'X-CSRF-Token', 'X-TrueLead-Project'],
    maxAge: 86400
  });
}));

app.options('*', cors((req, callback) => {
  const origin = req.header('Origin');
  const isPublic = isPublicEmbedPath(req);
  const allowed = isPublic || isAllowedOrigin(origin);

  callback(null, {
    origin: allowed ? (origin || true) : false,
    credentials: !isPublic,
    methods: ['GET', 'POST', 'PUT', 'PATCH', 'DELETE', 'OPTIONS'],
    allowedHeaders: ['Content-Type', 'Authorization', 'X-CSRF-Token', 'X-TrueLead-Project'],
    maxAge: 86400
  });
}));

const generalApiLimit = createRateLimit({ windowMs: 15 * 60_000, max: 1800 });
const loginLimit = createRateLimit({ windowMs: 15 * 60_000, max: 10, message: 'Demasiados intentos de acceso. Esperá 15 minutos.' });
const registerLimit = createRateLimit({ windowMs: 60 * 60_000, max: 5, message: 'Alcanzaste el límite de registros desde esta conexión.' });
const emailLimit = createRateLimit({ windowMs: 60 * 60_000, max: 5 });
const webhookLimit = createRateLimit({ windowMs: 60_000, max: 600 });
const preleadLimit = createRateLimit({
  windowMs: 60_000,
  max: 45,
  keyGenerator: (req) => `${req.ip}:${String(req.body?.projectPublicId || req.body?.projectId || '').slice(0, 80)}`,
  message: 'Se alcanzó el límite temporal de intentos para esta landing.'
});

function requireTrustedBrowserOrigin(req, res, next) {
  const origin = req.header('Origin');
  if (!origin || isAllowedOrigin(origin)) return next();
  return res.status(403).json({ error: 'Origen no autorizado.' });
}

// Los límites que no necesitan leer el body corren antes del parser JSON.
app.use('/api', (req, res, next) => (
  req.path.startsWith('/webhooks/') ? next() : generalApiLimit(req, res, next)
));
app.use('/api/webhooks', webhookLimit);
app.use('/api/auth', requireTrustedBrowserOrigin);
app.use('/api/auth/login', loginLimit);
app.use('/api/auth/register', registerLimit);
app.use('/api/auth/resend-verification', emailLimit);
app.use('/api/auth/verify-email', emailLimit);

morgan.token('safe-url', (req) => String(req.originalUrl || req.url || '').split('?')[0]);
app.use(morgan(process.env.NODE_ENV === 'production'
  ? ':remote-addr - :remote-user [:date[clf]] ":method :safe-url HTTP/:http-version" :status :res[content-length] ":referrer" ":user-agent"'
  : 'dev'));

// El exportador acepta imágenes más grandes que el JSON general. Se monta
// antes del parser de 1 MB y autentica/valida CSRF antes de leer ese body.
app.use('/api/agency/landing-builder', wrapAsyncRouter(landingBuilderRouter));

app.use(express.json({
  limit: '1mb',
  verify(req, _res, buffer) {
    if (String(req.originalUrl || '').split('?')[0] === '/api/webhooks/meta/whatsapp') {
      req.rawBody = Buffer.from(buffer);
    }
  }
}));
app.use(express.urlencoded({ extended: true }));

app.use('/api/preleads', preleadLimit);

app.get('/health', (req, res) => {
  res.json({
    ok: true,
    service: 'truelead-api',
    time: new Date().toISOString()
  });
});

app.use('/api/public', wrapAsyncRouter(publicRouter));
app.use('/api/auth', wrapAsyncRouter(authRouter));
app.use('/api', wrapAsyncRouter(preleadRouter));
app.use('/api/agency', wrapAsyncRouter(agencyRouter));
app.use('/api/admin', wrapAsyncRouter(adminRouter));
app.use('/api/whatsapp', wrapAsyncRouter(whatsappRouter));

app.use('/api', (error, req, res, next) => {
  console.error(`[api-error] ${req.method} ${String(req.originalUrl || req.url || '').split('?')[0]}:`, error.message);
  if (res.headersSent) return next(error);
  if (error?.type === 'entity.parse.failed' || error?.status === 400) {
    return res.status(400).json({ error: 'El cuerpo JSON de la solicitud es inválido.' });
  }
  if (error?.type === 'entity.too.large' || error?.status === 413) {
    return res.status(413).json({ error: 'La solicitud supera el tamaño permitido.' });
  }
  return res.status(500).json({ error: 'Ocurrió un error interno. Intentá nuevamente.' });
});

app.use('/api', (req, res) => {
  res.status(404).json({ error: 'Endpoint no encontrado.' });
});


const cleanPageRoutes = new Map([
  ['/login', 'login.html'],
  ['/register', 'register.html'],
  ['/verify-email', 'verify-email.html'],
  ['/logout', 'logout.html'],
  ['/admin-login', 'admin-login.html'],
  ['/panel', 'app.html'],
  ['/app', 'app.html'],
  ['/admin', 'admin.html']
]);

const htmlRedirects = new Map([
  ['/index.html', '/'],
  ['/login.html', '/login'],
  ['/register.html', '/register'],
  ['/verify-email.html', '/verify-email'],
  ['/logout.html', '/logout'],
  ['/connect.html', '/panel'],
  ['/admin-login.html', '/admin-login'],
  ['/app.html', '/panel'],
  ['/admin.html', '/admin']
]);

app.use((req, res, next) => {
  if (req.path.length > 1 && req.path.endsWith('/') && !req.path.startsWith('/api/')) {
    const query = req.url.includes('?') ? req.url.slice(req.url.indexOf('?')) : '';
    return res.redirect(301, `${req.path.slice(0, -1)}${query}`);
  }

  const cleanTarget = htmlRedirects.get(req.path);
  if (!cleanTarget) return next();
  const query = req.url.includes('?') ? req.url.slice(req.url.indexOf('?')) : '';
  return res.redirect(301, `${cleanTarget}${query}`);
});

for (const [routePath, fileName] of cleanPageRoutes.entries()) {
  app.get(routePath, (req, res) => {
    res.sendFile(path.join(frontendDir, fileName));
  });
}

app.get('/connect', (req, res) => res.redirect(302, '/panel'));

app.use('/sdk', express.static(path.join(frontendDir, 'sdk'), {
  maxAge: process.env.NODE_ENV === 'production' ? '1h' : 0,
  setHeaders(res) {
    res.setHeader('Access-Control-Allow-Origin', '*');
    res.setHeader('Cross-Origin-Resource-Policy', 'cross-origin');
    res.setHeader('Cross-Origin-Embedder-Policy', 'unsafe-none');
    res.setHeader('X-Content-Type-Options', 'nosniff');
  }
}));

app.use(express.static(frontendDir));

app.get('*', (req, res) => {
  res.sendFile(path.join(frontendDir, 'index.html'));
});

await db.init();
if (migrateEncryptedProjectSecrets(db.data.projects)) await db.save();
await whatsappManager.init();
await conversionQueue.init();
app.locals.whatsappManager = whatsappManager;

const httpServer = app.listen(port, () => {
  console.log(`TrueLead running on http://localhost:${port}`);
  console.log(`Storage: ${db.storage}${db.storage === 'json' ? ` (${db.filePath})` : ''}`);
});

let shuttingDown = false;
async function shutdown(signal) {
  if (shuttingDown) return;
  shuttingDown = true;
  console.log(`[shutdown] ${signal}`);
  conversionQueue.stop();
  const forceClose = setTimeout(() => httpServer.closeAllConnections?.(), 10_000);
  forceClose.unref?.();
  await new Promise((resolve) => httpServer.close(resolve));
  clearTimeout(forceClose);
  await whatsappManager.shutdown();
  await db.close();
  process.exit(0);
}

function handleShutdown(signal) {
  shutdown(signal).catch((error) => {
    console.error('[shutdown] error:', error.message);
    process.exitCode = 1;
  });
}

process.once('SIGTERM', () => handleShutdown('SIGTERM'));
process.once('SIGINT', () => handleShutdown('SIGINT'));
