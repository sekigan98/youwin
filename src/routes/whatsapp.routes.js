import express from 'express';
import { db } from '../lib/db.js';
import { cleanString, normalizeWhatsAppNumber } from '../lib/utils.js';
import { requireAuth, requireActiveAgency } from '../middleware/auth.js';
import { getPlanById, getPlanCapabilities, hasActiveEntitlement, isWithinPlanLimit } from '../lib/pricing.js';

export const whatsappRouter = express.Router();

whatsappRouter.use(requireAuth, requireActiveAgency);

function getManager(req) {
  return req.app.locals.whatsappManager;
}

function getClientName(agencyId, clientId) {
  return db.data.clients.find((client) => client.id === clientId && client.agencyId === agencyId)?.name || '';
}

function requireWhatsappAllowed(req, res) {
  const agency = db.data.agencies.find((a) => a.id === req.auth.agencyId);
  const capabilities = getPlanCapabilities(agency?.plan || 'free');
  if (capabilities.canConnectWhatsapp || req.auth.role === 'admin') return { ok: true, agency, capabilities };

  res.status(402).json({
    error: 'Tu cuenta Free es solo vista previa. Actualizá a Starter o superior para vincular WhatsApp por QR.',
    requiredPlan: 'starter',
    currentPlan: agency?.plan || 'free'
  });
  return { ok: false, agency, capabilities };
}

function enrichSession(req, session) {
  if (!session) return null;
  const agency = db.data.agencies.find((item) => item.id === req.auth.agencyId);
  const canViewQr = req.auth.role === 'admin' || (
    hasActiveEntitlement(agency) && getPlanCapabilities(agency?.plan || 'free').canConnectWhatsapp
  );
  return {
    ...session,
    qr: null,
    qrDataUrl: canViewQr ? session.qrDataUrl : null,
    client: getClientName(req.auth.agencyId, session.clientId)
  };
}

whatsappRouter.get('/sessions', async (req, res) => {
  const sessions = getManager(req)
    .listSessions(req.auth.agencyId)
    .map((session) => enrichSession(req, session));

  res.json({ sessions });
});

whatsappRouter.get('/status', async (req, res) => {
  const session = getManager(req).getSession(req.auth.agencyId, req.query.sessionId || '');
  res.json({ session: enrichSession(req, session) });
});

whatsappRouter.post('/request-qr', async (req, res) => {
  const allowed = requireWhatsappAllowed(req, res);
  if (!allowed.ok) return;
  try {
    const clientId = cleanString(req.body.clientId, 80);
    const label = cleanString(req.body.label || 'WhatsApp principal', 120);
    const sessionId = cleanString(req.body.sessionId, 80);

    const existingSession = sessionId
      ? getManager(req).getSession(req.auth.agencyId, sessionId)
      : null;
    if (sessionId && !existingSession) return res.status(404).json({ error: 'WhatsApp vinculado no encontrado.' });

    const effectiveClientId = clientId || existingSession?.clientId || '';
    const client = db.data.clients.find((item) => item.id === effectiveClientId && item.agencyId === req.auth.agencyId);
    if (!client) {
      return res.status(400).json({ error: 'Seleccioná un cliente válido para vincular este WhatsApp.' });
    }

    if (!sessionId) {
      const agency = db.data.agencies.find((a) => a.id === req.auth.agencyId);
      const plan = getPlanById(agency?.plan || 'starter');
      const qrCount = db.data.whatsappSessions.filter((session) => session.agencyId === req.auth.agencyId).length;
      const cloudPhoneIds = new Set(db.data.projects
        .filter((project) => project.agencyId === req.auth.agencyId)
        .filter((project) => project.trackingMode === 'cloud_api' || (project.trackingMode === 'hybrid' && !project.whatsappSessionId))
        .map((project) => project.metaPhoneNumberId)
        .filter(Boolean));
      const current = qrCount + cloudPhoneIds.size;
      if (!isWithinPlanLimit(current, plan.whatsappLimit)) {
        return res.status(403).json({ error: `Tu plan ${plan.name} permite hasta ${plan.whatsappLimit} WhatsApp(s) conectados. Actualizá el plan para agregar más.` });
      }
    }

    const session = await getManager(req).start({
      agencyId: req.auth.agencyId,
      sessionId,
      clientId: effectiveClientId,
      label
    });

    res.json({
      session: enrichSession(req, session),
      message: session?.status === 'connected'
        ? 'WhatsApp ya está conectado.'
        : 'QR real generado. Escanealo desde WhatsApp > Dispositivos vinculados.'
    });
  } catch (err) {
    res.status(500).json({
      error: err.message || 'No se pudo iniciar la vinculación de WhatsApp.'
    });
  }
});

whatsappRouter.post('/reconnect', async (req, res) => {
  const allowed = requireWhatsappAllowed(req, res);
  if (!allowed.ok) return;
  try {
    const sessionId = cleanString(req.body.sessionId || req.query.sessionId, 80);
    if (!sessionId) return res.status(400).json({ error: 'Falta sessionId.' });

    const existing = getManager(req).getSession(req.auth.agencyId, sessionId);
    if (!existing) return res.status(404).json({ error: 'WhatsApp vinculado no encontrado.' });

    const session = await getManager(req).start({
      agencyId: req.auth.agencyId,
      sessionId,
      clientId: existing.clientId,
      label: existing.label
    });

    res.json({ session: enrichSession(req, session) });
  } catch (err) {
    res.status(500).json({ error: err.message || 'No se pudo reconectar WhatsApp.' });
  }
});

whatsappRouter.post('/disconnect', async (req, res) => {
  try {
    const sessionId = cleanString(req.body.sessionId || req.query.sessionId, 80);
    if (!sessionId) return res.status(400).json({ error: 'Falta sessionId.' });

    const session = await getManager(req).disconnect(req.auth.agencyId, sessionId);
    if (!session) return res.status(404).json({ error: 'WhatsApp vinculado no encontrado.' });

    res.json({ session: enrichSession(req, session), removed: true, message: 'WhatsApp desvinculado correctamente.' });
  } catch (err) {
    res.status(500).json({ error: err.message || 'No se pudo desconectar WhatsApp.' });
  }
});

whatsappRouter.post('/reset', async (req, res) => {
  const allowed = requireWhatsappAllowed(req, res);
  if (!allowed.ok) return;
  try {
    const sessionId = cleanString(req.body.sessionId || req.query.sessionId, 80);
    if (!sessionId) return res.status(400).json({ error: 'Falta sessionId.' });

    const session = await getManager(req).resetSession(req.auth.agencyId, sessionId);
    if (!session) return res.status(404).json({ error: 'WhatsApp vinculado no encontrado.' });

    res.json({
      session: enrichSession(req, session),
      message: 'Sesión eliminada. Podés generar un nuevo QR.'
    });
  } catch (err) {
    res.status(500).json({ error: err.message || 'No se pudo resetear la sesión.' });
  }
});

/*
  Solo para pruebas del panel, se puede desactivar con:
  WHATSAPP_ALLOW_DEMO_CONNECT=false
*/
whatsappRouter.post('/mark-connected', async (req, res) => {
  const allowed = requireWhatsappAllowed(req, res);
  if (!allowed.ok) return;
  if (process.env.NODE_ENV === 'production' || process.env.WHATSAPP_ALLOW_DEMO_CONNECT !== 'true') {
    return res.status(403).json({ error: 'La conexión demo está desactivada.' });
  }

  const sessionId = cleanString(req.body.sessionId || req.query.sessionId, 80);
  if (!sessionId) return res.status(400).json({ error: 'Falta sessionId.' });
  if (!getManager(req).getSession(req.auth.agencyId, sessionId)) {
    return res.status(404).json({ error: 'WhatsApp vinculado no encontrado.' });
  }

  const session = await getManager(req).updateSession(req.auth.agencyId, sessionId, {
    status: 'connected',
    number: normalizeWhatsAppNumber(req.body.number || '+54 11 0000 0000'),
    device: req.body.device || 'Demo browser',
    lastError: '',
    qr: null,
    qrDataUrl: null
  });

  res.json({ session: enrichSession(req, session) });
});
