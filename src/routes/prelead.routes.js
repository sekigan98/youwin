import express from 'express';
import crypto from 'node:crypto';
import { db } from '../lib/db.js';
import {
  cleanString,
  getClientIp,
  normalizePhone,
  normalizeWhatsAppNumber,
  nowIso,
  publicCode,
  extractLeadCode,
  normalizeOrigin,
  parseAuthorizedDomains,
  originMatchesAuthorizedDomains
} from '../lib/utils.js';
import { requireAuth } from '../middleware/auth.js';
import { confirmPreleadByCode, registerIncomingWhatsAppMessage } from '../services/leadEvents.service.js';
import { getPlanCapabilities, hasActiveEntitlement } from '../lib/pricing.js';
import {
  extractMetaWhatsAppMessages,
  verifyMetaWebhookSignature
} from '../services/metaWhatsAppWebhook.service.js';

export const preleadRouter = express.Router();

function getRequestOrigin(req) {
  const origin = normalizeOrigin(req.headers.origin || '');
  if (origin) return origin;

  const referer = normalizeOrigin(req.headers.referer || '');
  if (referer) return referer;

  return '';
}

function projectAgencyCapabilities(project) {
  const agency = db.data.agencies.find((item) => item.id === project.agencyId);
  return getPlanCapabilities(hasActiveEntitlement(agency) ? (agency?.plan || 'free') : 'free');
}

function validateProjectLandingOrigin(project, req) {
  const allowedDomains = parseAuthorizedDomains(project.domain);
  if (!allowedDomains.length) {
    return {
      ok: false,
      status: 403,
      error: 'Este proyecto no tiene dominios autorizados. Agregá el dominio de la landing en el proyecto.'
    };
  }

  const requestOrigin = getRequestOrigin(req);
  if (!requestOrigin) {
    return {
      ok: false,
      status: 403,
      error: 'No se pudo verificar el dominio de origen de la landing.'
    };
  }

  if (!originMatchesAuthorizedDomains(requestOrigin, project.domain)) {
    return {
      ok: false,
      status: 403,
      origin: requestOrigin,
      allowedDomains: allowedDomains.map((item) => item.raw),
      error: `Dominio no autorizado para este proyecto: ${requestOrigin}. Agregalo en el campo Dominios autorizados del proyecto.`
    };
  }

  return { ok: true, origin: requestOrigin };
}

function generateUniqueLeadCode() {
  for (let i = 0; i < 20; i++) {
    const code = publicCode('TL', 6);
    if (!db.data.preleads.some((lead) => lead.code === code)) return code;
  }
  return `TL-${Date.now().toString(36).toUpperCase()}`;
}

function cleanTrackingObject(value) {
  if (!value || typeof value !== 'object' || Array.isArray(value)) return {};
  return Object.fromEntries(Object.entries(value)
    .slice(0, 20)
    .map(([key, item]) => [cleanString(key, 80), cleanString(item, 240)])
    .filter(([key]) => key));
}

function cleanLandingUrl(value, expectedOrigin) {
  try {
    const url = new URL(cleanString(value, 1000));
    if (normalizeOrigin(url.origin) !== expectedOrigin) return expectedOrigin;
    return `${url.origin}${url.pathname}`.slice(0, 500);
  } catch {
    return expectedOrigin;
  }
}

function cleanExternalUrl(value) {
  try {
    const url = new URL(cleanString(value, 1000));
    if (!['http:', 'https:'].includes(url.protocol)) return '';
    return `${url.origin}${url.pathname}`.slice(0, 500);
  } catch {
    return '';
  }
}

function secureSecretMatches(received, expected) {
  const left = Buffer.from(String(received || ''));
  const right = Buffer.from(String(expected || ''));
  return left.length === right.length && left.length > 0 && crypto.timingSafeEqual(left, right);
}

function splitIdentifiers(value) {
  return String(value || '').split(/[\s,;]+/).map((item) => item.trim()).filter(Boolean);
}

function projectSupportsCloudApi(project) {
  return ['cloud_api', 'hybrid'].includes(project.trackingMode) && Boolean(project.metaPhoneNumberId && project.metaWabaId);
}

function cloudApiProjectCandidates(message) {
  return db.data.projects.filter((project) => {
    if (project.status !== 'active' || !projectSupportsCloudApi(project)) return false;
    if (String(project.metaPhoneNumberId) !== String(message.phoneNumberId)) return false;
    const agency = db.data.agencies.find((item) => item.id === project.agencyId);
    return getPlanCapabilities(hasActiveEntitlement(agency) ? agency.plan : 'free').canUseMetaCapi;
  });
}

function findCloudApiProject(message) {
  const candidates = cloudApiProjectCandidates(message);

  if (message.sourceId) {
    const mapped = candidates.filter((project) => splitIdentifiers(project.metaAdIds).includes(message.sourceId));
    if (mapped.length === 1) return mapped[0];
  }
  return candidates.length === 1 ? candidates[0] : null;
}

export async function processMetaCloudMessage(message) {
  let prelead = message.ctwaClid
    ? db.data.preleads.find((lead) => lead.ctwaClid === message.ctwaClid)
    : null;
  if (!prelead && message.from) {
    const sender = normalizePhone(message.from);
    const associationDays = Math.max(1, Math.min(365, Number(process.env.LEAD_ASSOCIATION_WINDOW_DAYS || 30)));
    const cutoff = Date.now() - associationDays * 24 * 60 * 60 * 1000;
    const previousMessage = [...db.data.whatsappMessages].reverse().find((item) => {
      const previousProject = db.data.projects.find((candidate) => candidate.id === item.projectId);
      const previousPhoneId = item.metaPhoneNumberId || previousProject?.metaPhoneNumberId || '';
      const previousWabaId = item.whatsappBusinessAccountId || previousProject?.metaWabaId || '';
      return item.source === 'whatsapp_cloud_api' &&
        normalizePhone(item.fromPhone) === sender &&
        item.preleadId &&
        String(previousPhoneId) === String(message.phoneNumberId) &&
        (!message.wabaId || String(previousWabaId) === String(message.wabaId)) &&
        new Date(item.receivedAt || item.createdAt || 0).getTime() >= cutoff;
    });
    if (previousMessage) {
      prelead = db.data.preleads.find((lead) => lead.id === previousMessage.preleadId) || null;
    }
  }
  let project = prelead
    ? db.data.projects.find((item) =>
      item.id === prelead.projectId &&
      item.status === 'active' &&
      projectSupportsCloudApi(item) &&
      String(item.metaPhoneNumberId) === String(message.phoneNumberId) &&
      (!message.wabaId || String(item.metaWabaId) === String(message.wabaId))
    )
    : findCloudApiProject(message);

  if (project) {
    const agency = db.data.agencies.find((item) => item.id === project.agencyId);
    const capabilities = getPlanCapabilities(hasActiveEntitlement(agency) ? agency.plan : 'free');
    if (!capabilities.canUseMetaCapi) {
      return { ok: true, skipped: true, reason: 'La agencia no tiene un plan activo para procesar Cloud API.' };
    }
  }

  if (!project) {
    const candidates = cloudApiProjectCandidates(message);
    const agencies = [...new Set(candidates.map((item) => item.agencyId))];
    if (agencies.length === 1) {
      db.data.events.push({
        id: `ev_${Date.now()}_${Math.random().toString(36).slice(2)}`,
        agencyId: agencies[0],
        projectId: null,
        type: 'cloud_attribution_ambiguous',
        message: `Mensaje Cloud API omitido: Phone Number ID compartido sin source_id de anuncio inequívoco.`,
        createdAt: nowIso()
      });
      await db.save();
    }
    return { ok: true, skipped: true, reason: 'No hay un proyecto Cloud API inequívoco para ese Phone Number ID/anuncio.' };
  }

  if (!prelead && message.ctwaClid) {
    const code = generateUniqueLeadCode();
    prelead = await db.insert('preleads', {
      agencyId: project.agencyId,
      clientId: project.clientId,
      projectId: project.id,
      projectPublicId: project.publicId,
      code,
      status: 'intent',
      metaStatus: 'pending',
      trackingMode: 'cloud_api',
      source: 'meta_click_to_whatsapp',
      landingUrl: cleanExternalUrl(message.sourceUrl),
      landingOrigin: normalizeOrigin(message.sourceUrl),
      visitorId: `ctwa_${crypto.createHash('sha256').update(message.ctwaClid).digest('hex').slice(0, 24)}`,
      buttonSource: cleanString(message.sourceId || 'meta_ad', 120),
      utm: {},
      ctwaClid: cleanString(message.ctwaClid, 500),
      metaAdId: cleanString(message.sourceId, 120),
      whatsappBusinessAccountId: cleanString(message.wabaId || project.metaWabaId, 120),
      metaPhoneNumberId: cleanString(message.phoneNumberId, 120),
      whatsappTo: normalizeWhatsAppNumber(message.displayPhoneNumber),
      incomingMessageCount: 0,
      confirmedAt: null,
      metaResponse: null,
      purchaseStatus: 'none'
    });
  }

  return registerIncomingWhatsAppMessage({
    agencyId: project.agencyId,
    clientId: project.clientId,
    projectId: project.id,
    preleadId: prelead?.id || '',
    messageId: message.messageId,
    from: message.from,
    senderName: message.senderName,
    text: message.text,
    messageType: message.messageType,
    mimeType: message.mimeType,
    fileName: message.fileName,
    hasMedia: message.hasMedia,
    metaPhoneNumberId: message.phoneNumberId,
    whatsappBusinessAccountId: message.wabaId || project.metaWabaId,
    allowPhoneAssociation: Boolean(prelead),
    source: 'whatsapp_cloud_api'
  });
}

function getProjectWhatsapp(project) {
  let session = db.data.whatsappSessions.find((item) =>
    item.id === project.whatsappSessionId && item.agencyId === project.agencyId
  );

  // Fallback suave para proyectos viejos sin whatsappSessionId.
  if (!session && project.clientId) {
    session = db.data.whatsappSessions.find((item) =>
      item.agencyId === project.agencyId &&
      item.clientId === project.clientId &&
      item.status === 'connected'
    );
  }

  const sessionNumber = normalizeWhatsAppNumber(session?.number || '');
  const fallbackNumber = normalizeWhatsAppNumber(project.whatsappNumber || '');
  const finalNumber = sessionNumber || fallbackNumber;

  return {
    number: finalNumber,
    session,
    status: session?.status || (fallbackNumber ? 'manual_fallback' : 'missing')
  };
}

function buildWhatsAppMessage(project, code, template = '') {
  const rawTemplate = cleanString(template, 700);
  if (rawTemplate) {
    if (rawTemplate.includes('{{code}}')) {
      return rawTemplate.replaceAll('{{code}}', code);
    }
    return `${rawTemplate} ${code}`.trim();
  }

  return `Hola, quiero recibir información. Mi código es: ${code}`;
}

function buildWhatsAppHref(phone, message) {
  const normalized = normalizeWhatsAppNumber(phone);
  if (!normalized) return '';
  return `https://wa.me/${normalized}?text=${encodeURIComponent(message)}`;
}

preleadRouter.post('/preleads', async (req, res) => {
  const publicId = cleanString(req.body.projectPublicId || req.body.project_id || req.body.projectId, 80);
  const project = db.data.projects.find((p) => p.publicId === publicId && p.status === 'active');

  if (!project) {
    return res.status(404).json({ error: 'Proyecto no encontrado o inactivo.' });
  }

  if (project.trackingMode === 'cloud_api') {
    return res.status(400).json({ error: 'Este proyecto recibe conversaciones desde el webhook oficial de WhatsApp Cloud API y no usa el SDK de landing.' });
  }

  const capabilities = projectAgencyCapabilities(project);
  if (!capabilities.canUseSdk) {
    return res.status(402).json({ error: 'Este proyecto pertenece a una cuenta Free. Activá Starter o superior para crear códigos TL desde la landing.' });
  }

  const originValidation = validateProjectLandingOrigin(project, req);
  if (!originValidation.ok) {
    return res.status(originValidation.status || 403).json({
      error: originValidation.error,
      origin: originValidation.origin
    });
  }

  const whatsapp = getProjectWhatsapp(project);
  if (!whatsapp.number) {
    return res.status(400).json({ error: 'Este proyecto todavía no tiene WhatsApp vinculado por QR.' });
  }

  const visitorId = cleanString(req.body.visitorId, 120);
  const buttonSource = cleanString(req.body.buttonSource || req.body.source, 120);
  const duplicateSince = Date.now() - 30_000;
  const recentDuplicate = visitorId
    ? [...db.data.preleads].reverse().find((lead) =>
      lead.projectId === project.id &&
      lead.visitorId === visitorId &&
      lead.buttonSource === buttonSource &&
      new Date(lead.createdAt).getTime() >= duplicateSince
    )
    : null;

  if (recentDuplicate) {
    return res.json({
      ok: true,
      duplicate: true,
      code: recentDuplicate.code,
      message: recentDuplicate.message,
      whatsappHref: recentDuplicate.whatsappHref,
      project: { name: project.name, publicId: project.publicId },
      landingOrigin: recentDuplicate.landingOrigin
    });
  }

  const code = generateUniqueLeadCode();
  const message = buildWhatsAppMessage(project, code, req.body.messageTemplate || req.body.message);
  const whatsappHref = buildWhatsAppHref(whatsapp.number, message);

  const prelead = await db.insert('preleads', {
    agencyId: project.agencyId,
    clientId: project.clientId,
    projectId: project.id,
    projectPublicId: project.publicId,
    code,
    status: 'intent',
    metaStatus: 'pending',
    landingUrl: cleanLandingUrl(req.body.landingUrl || req.headers.referer || '', originValidation.origin),
    landingOrigin: originValidation.origin,
    visitorId,
    buttonSource,
    messageTemplate: cleanString(req.body.messageTemplate || req.body.message, 700),
    fbp: cleanString(req.body.fbp, 240),
    fbc: cleanString(req.body.fbc, 240),
    utm: cleanTrackingObject(req.body.utm),
    ip: getClientIp(req),
    userAgent: cleanString(req.headers['user-agent'], 500),
    whatsappSessionId: whatsapp.session?.id || project.whatsappSessionId || '',
    whatsappTo: whatsapp.number,
    whatsappHref,
    message,
    incomingMessageCount: 0,
    confirmedAt: null,
    metaResponse: null,
    purchaseStatus: 'none'
  });

  db.data.events.push({
    id: `ev_${Date.now()}_${Math.random().toString(36).slice(2)}`,
    agencyId: project.agencyId,
    projectId: project.id,
    type: 'prelead_created',
    message: `Prelead ${code} creado.`,
    createdAt: nowIso()
  });

  await db.save();

  return res.status(201).json({
    ok: true,
    code,
    message,
    whatsappHref,
    project: {
      name: project.name,
      publicId: project.publicId
    },
    landingOrigin: originValidation.origin
  });
});

preleadRouter.post('/preleads/:code/confirm', requireAuth, async (req, res) => {
  const normalizedCode = cleanString(req.params.code, 40).toUpperCase();
  const existingLead = db.data.preleads.find((lead) => lead.code === normalizedCode);
  if (!existingLead) return res.status(404).json({ error: 'Código no encontrado.' });
  if (req.auth.role !== 'admin' && existingLead.agencyId !== req.auth.agencyId) {
    return res.status(403).json({ error: 'No podés confirmar este lead.' });
  }

  if (req.auth.role !== 'admin') {
    const agency = db.data.agencies.find((item) => item.id === req.auth.agencyId);
    const capabilities = getPlanCapabilities(hasActiveEntitlement(agency) ? (agency?.plan || 'free') : 'free');
    if (!capabilities.canUseSdk) {
      return res.status(402).json({ error: 'Tu cuenta Free es solo vista previa. Activá Starter o superior para confirmar leads.' });
    }
  }

  const result = await confirmPreleadByCode({
    code: normalizedCode,
    phone: req.body.phone || req.body.whatsappFrom || '',
    source: req.body.source || 'manual_panel',
    sendToMeta: req.body.sendToMeta !== false,
    messageText: req.body.messageText || '',
    testEventCode: req.body.testEventCode || ''
  });

  if (!result.ok) {
    return res.status(result.status || 400).json({ error: result.error });
  }

  return res.json({ ok: true, lead: result.lead, meta: result.meta });
});

preleadRouter.get('/webhooks/meta/whatsapp', (req, res) => {
  const mode = cleanString(req.query['hub.mode'], 40);
  const verifyToken = cleanString(req.query['hub.verify_token'], 500);
  const challenge = cleanString(req.query['hub.challenge'], 500);
  const expectedToken = process.env.META_WHATSAPP_VERIFY_TOKEN;

  if (mode !== 'subscribe' || !expectedToken || !secureSecretMatches(verifyToken, expectedToken)) {
    return res.sendStatus(403);
  }
  return res.status(200).type('text/plain').send(challenge);
});

preleadRouter.post('/webhooks/meta/whatsapp', async (req, res) => {
  const appSecret = process.env.META_APP_SECRET;
  const signature = req.headers['x-hub-signature-256'];
  if (!appSecret) return res.status(503).json({ error: 'Webhook oficial de Meta no configurado.' });
  if (!verifyMetaWebhookSignature({ rawBody: req.rawBody, signature, appSecret })) {
    return res.status(401).json({ error: 'Firma de Meta inválida.' });
  }

  const messages = extractMetaWhatsAppMessages(req.body);
  const results = [];
  try {
    for (const message of messages) results.push(await processMetaCloudMessage(message));
  } catch (error) {
    console.error('[meta-whatsapp-webhook] processing failed:', error.message);
    return res.status(500).json({ error: 'No se pudo procesar el webhook. Meta puede reintentarlo.' });
  }

  return res.json({ ok: true, received: messages.length, processed: results.filter((item) => !item.skipped).length });
});

preleadRouter.post('/webhooks/whatsapp/message', async (req, res) => {
  const secret = req.headers['x-truelead-secret'];
  const expectedSecret = process.env.WHATSAPP_WEBHOOK_SECRET;
  if (!expectedSecret) {
    return res.status(503).json({ error: 'Webhook no configurado.' });
  }
  if (!secureSecretMatches(secret, expectedSecret)) {
    return res.status(401).json({ error: 'Webhook no autorizado.' });
  }

  const text = cleanString(req.body.text || req.body.message, 2000);
  const code = extractLeadCode(text);
  const prelead = code ? db.data.preleads.find((l) => l.code === code) : null;
  const requestedAgencyId = cleanString(req.body.agencyId, 80);
  if (prelead && requestedAgencyId && requestedAgencyId !== prelead.agencyId) {
    return res.status(400).json({ error: 'El código TL no pertenece a la agencia indicada.' });
  }
  const agencyId = prelead?.agencyId || requestedAgencyId;

  if (!agencyId) {
    return res.status(400).json({ error: 'No se pudo asociar el mensaje a una agencia.' });
  }
  const agency = db.data.agencies.find((item) => item.id === agencyId);
  if (!hasActiveEntitlement(agency) || !getPlanCapabilities(agency?.plan || 'free').canUseSdk) {
    return res.status(402).json({ error: 'La agencia no tiene un plan activo para procesar mensajes.' });
  }

  const requestedSessionId = cleanString(req.body.whatsappSessionId, 80);
  const session = requestedSessionId
    ? db.data.whatsappSessions.find((item) => item.id === requestedSessionId && item.agencyId === agencyId)
    : null;
  if (requestedSessionId && !session) {
    return res.status(400).json({ error: 'La sesión de WhatsApp no pertenece a la agencia indicada.' });
  }

  const requestedClientId = cleanString(req.body.clientId || session?.clientId, 80);
  const client = requestedClientId
    ? db.data.clients.find((item) => item.id === requestedClientId && item.agencyId === agencyId)
    : null;
  if (requestedClientId && !client) {
    return res.status(400).json({ error: 'El cliente no pertenece a la agencia indicada.' });
  }

  const result = await registerIncomingWhatsAppMessage({
    agencyId,
    clientId: client?.id || '',
    whatsappSessionId: session?.id || '',
    preleadId: prelead?.id || '',
    messageId: req.body.messageId || '',
    from: req.body.from || req.body.phone || '',
    text,
    messageType: req.body.messageType || (req.body.hasMedia ? 'document' : 'text'),
    mimeType: req.body.mimeType || '',
    fileName: req.body.fileName || '',
    hasMedia: Boolean(req.body.hasMedia),
    allowPhoneAssociation: Boolean(session || client),
    source: 'webhook'
  });

  return res.json({
    ok: true,
    duplicate: Boolean(result.duplicate),
    messageId: result.message?.id || '',
    leadId: result.lead?.id || '',
    purchaseId: result.purchase?.id || ''
  });
});
