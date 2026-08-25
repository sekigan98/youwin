import { nanoid } from 'nanoid';
import { db } from '../lib/db.js';
import {
  cleanString,
  extractLeadCode,
  normalizeLeadPhone,
  normalizePhone,
  nowIso,
  sha256
} from '../lib/utils.js';
import { conversionQueue } from './conversionQueue.service.js';

function getPhoneHash(phone) {
  const normalized = normalizeLeadPhone(phone);
  return normalized ? sha256(normalized) : '';
}

function getLidHash(lid) {
  const normalized = cleanString(lid, 160).toLowerCase();
  return normalized ? sha256(`lid:${normalized}`) : '';
}

function getSenderHash({ phone = '', lid = '' } = {}) {
  return getPhoneHash(phone) || getLidHash(lid);
}

function phoneLast4(phone) {
  const normalized = normalizeLeadPhone(phone);
  return normalized ? normalized.slice(-4) : '';
}

function pushEvent({ agencyId, projectId, type, message }) {
  db.data.events.push({
    id: `ev_${Date.now()}_${Math.random().toString(36).slice(2)}`,
    agencyId,
    projectId,
    type,
    message,
    createdAt: nowIso()
  });
}

function isPaymentProofMedia({ messageType = '', mimeType = '', fileName = '' }) {
  const type = String(messageType || '').toLowerCase();
  const mime = String(mimeType || '').toLowerCase();
  const name = String(fileName || '').toLowerCase();

  // Stickers y GIFs son interacción, no comprobantes.
  if (type === 'sticker') return false;
  if (type === 'gif' || mime === 'image/gif' || name.endsWith('.gif')) return false;
  if (mime === 'image/webp' || name.endsWith('.webp')) return false;

  // Comprobante válido: foto real o documento/archivo tipo PDF/imagen/documento.
  if (type === 'image') return true;
  if (type === 'document') return true;

  return false;
}


export async function confirmPreleadByCode({
  code,
  phone = '',
  lid = '',
  fromJid = '',
  senderName = '',
  source = 'manual',
  sendToMeta = true,
  messageText = '',
  testEventCode = ''
}) {
  const normalizedCode = cleanString(code, 40).toUpperCase();
  const prelead = db.data.preleads.find((l) => l.code === normalizedCode);

  if (!prelead) {
    return { ok: false, status: 404, error: 'Código no encontrado.' };
  }

  const project = db.data.projects.find((p) => p.id === prelead.projectId);
  const normalizedPhone = normalizeLeadPhone(phone);
  const normalizedLid = cleanString(lid, 160);
  const normalizedJid = cleanString(fromJid, 180);
  const phoneHash = getSenderHash({ phone: normalizedPhone, lid: normalizedLid });

  const wasConfirmed = ['confirmed', 'sent_to_meta', 'payment_proof_received'].includes(prelead.status);
  prelead.status = prelead.status === 'sent_to_meta' ? prelead.status : 'confirmed';
  prelead.confirmedAt = prelead.confirmedAt || nowIso();
  prelead.whatsappFromLast4 = phoneLast4(normalizedPhone) || prelead.whatsappFromLast4 || '';
  prelead.whatsappFromHash = phoneHash || prelead.whatsappFromHash || '';
  prelead.whatsappFromPhone = normalizedPhone || prelead.whatsappFromPhone || '';
  prelead.phone = normalizedPhone || prelead.phone || '';
  prelead.whatsappFrom = normalizedPhone || prelead.whatsappFrom || '';
  prelead.whatsappFromLid = normalizedLid || prelead.whatsappFromLid || '';
  prelead.whatsappFromJid = normalizedJid || prelead.whatsappFromJid || '';
  prelead.whatsappFromName = cleanString(senderName, 160) || prelead.whatsappFromName || '';
  prelead.confirmationSource = source;
  prelead.lastMessagePreview = cleanString(messageText, 180);
  prelead.incomingMessageCount = Number(prelead.incomingMessageCount || 0) + 1;
  prelead.updatedAt = nowIso();

  let metaResult = null;
  if (sendToMeta && project && prelead.metaStatus !== 'sent') {
    const job = await conversionQueue.enqueue({
      agencyId: prelead.agencyId,
      projectId: prelead.projectId,
      preleadId: prelead.id,
      eventName: 'Lead',
      testEventCode
    });
    metaResult = { queued: true, jobId: job.id, status: job.status, testEventCode: cleanString(testEventCode, 120) };
    prelead.metaResponse = metaResult;
    if (prelead.metaStatus !== 'sent') prelead.metaStatus = job.status === 'sent' ? 'sent' : 'queued';
  }

  if (!wasConfirmed) {
    pushEvent({
      agencyId: prelead.agencyId,
      projectId: prelead.projectId,
      type: 'lead_confirmed',
      message: metaResult
        ? `Lead ${normalizedCode} confirmado y encolado para Meta.`
        : `Lead ${normalizedCode} confirmado sin envío a Meta.`
    });
  }

  await db.save();

  return { ok: true, lead: prelead, project, meta: metaResult };
}

function findRecentLeadByPhone({ agencyId, phoneHash, whatsappSessionId = '', clientId = '' }) {
  if (!phoneHash) return null;
  const associationDays = Math.max(1, Math.min(365, Number(process.env.LEAD_ASSOCIATION_WINDOW_DAYS || 30)));
  const cutoff = Date.now() - associationDays * 24 * 60 * 60 * 1000;

  return [...db.data.preleads]
    .filter((lead) =>
      lead.agencyId === agencyId &&
      lead.whatsappFromHash === phoneHash &&
      new Date(lead.updatedAt || lead.confirmedAt || lead.createdAt || 0).getTime() >= cutoff &&
      (!whatsappSessionId || !lead.whatsappSessionId || lead.whatsappSessionId === whatsappSessionId) &&
      (!clientId || !lead.clientId || lead.clientId === clientId) &&
      ['confirmed', 'sent_to_meta', 'payment_proof_received', 'intent'].includes(lead.status)
    )
    .sort((a, b) => String(b.confirmedAt || b.updatedAt || b.createdAt).localeCompare(String(a.confirmedAt || a.updatedAt || a.createdAt)))[0] || null;
}

export async function registerIncomingWhatsAppMessage({
  agencyId,
  clientId = '',
  projectId = '',
  whatsappSessionId = '',
  preleadId = '',
  messageId = '',
  from = '',
  fromLid = '',
  fromJid = '',
  senderName = '',
  text = '',
  messageType = 'text',
  mimeType = '',
  fileName = '',
  hasMedia = false,
  metaPhoneNumberId = '',
  whatsappBusinessAccountId = '',
  allowPhoneAssociation = true,
  source = 'baileys'
}) {
  const normalizedMessageId = cleanString(messageId, 200);
  if (normalizedMessageId) {
    const duplicate = db.data.whatsappMessages.find((message) =>
      message.agencyId === agencyId &&
      message.externalMessageId === normalizedMessageId &&
      (!whatsappSessionId || message.whatsappSessionId === whatsappSessionId)
    );
    if (duplicate) {
      return { ok: true, duplicate: true, message: duplicate, lead: duplicate.preleadId
        ? db.data.preleads.find((lead) => lead.id === duplicate.preleadId) || null
        : null };
    }
  }

  const normalizedPhone = normalizeLeadPhone(from);
  const normalizedLid = cleanString(fromLid, 160);
  const normalizedJid = cleanString(fromJid, 180);
  const phoneHash = getSenderHash({ phone: normalizedPhone, lid: normalizedLid });
  const code = extractLeadCode(text);
  let prelead = preleadId
    ? db.data.preleads.find((lead) => lead.id === preleadId && lead.agencyId === agencyId)
    : (code ? db.data.preleads.find((lead) => lead.code === code && lead.agencyId === agencyId) : null);

  if (!prelead && phoneHash && allowPhoneAssociation) {
    prelead = findRecentLeadByPhone({ agencyId, phoneHash, whatsappSessionId, clientId });
  }

  const detectedEvent = code
    ? 'lead_code_detected'
    : hasMedia
      ? 'media_received'
      : 'message_received';

  const messageRecord = await db.insert('whatsappMessages', {
    agencyId,
    whatsappSessionId: whatsappSessionId || prelead?.whatsappSessionId || '',
    clientId: prelead?.clientId || clientId || null,
    projectId: prelead?.projectId || projectId || null,
    preleadId: prelead?.id || null,
    code: prelead?.code || code || '',
    externalMessageId: normalizedMessageId,
    fromHash: phoneHash,
    fromLast4: phoneLast4(normalizedPhone),
    fromPhone: normalizedPhone,
    fromLid: normalizedLid,
    fromJid: normalizedJid,
    senderName: cleanString(senderName, 160),
    messageType,
    hasMedia,
    mimeType: cleanString(mimeType, 160),
    fileName: cleanString(fileName, 220),
    metaPhoneNumberId: cleanString(metaPhoneNumberId, 120),
    whatsappBusinessAccountId: cleanString(whatsappBusinessAccountId, 120),
    textPreview: cleanString(text, 180),
    detectedEvent,
    source,
    receivedAt: nowIso()
  });

  let leadResult = null;
  if ((code || preleadId) && prelead) {
    leadResult = await confirmPreleadByCode({
      code: prelead.code,
      phone: normalizedPhone,
      lid: normalizedLid,
      fromJid: normalizedJid,
      senderName,
      source: `${source}_message`,
      sendToMeta: true,
      messageText: text
    });
    prelead = leadResult.lead || prelead;
    if (prelead && whatsappSessionId && !prelead.whatsappSessionId) prelead.whatsappSessionId = whatsappSessionId;
    messageRecord.preleadId = prelead?.id || messageRecord.preleadId;
    messageRecord.clientId = prelead?.clientId || messageRecord.clientId;
    messageRecord.projectId = prelead?.projectId || messageRecord.projectId;
  } else if (prelead) {
    prelead.incomingMessageCount = Number(prelead.incomingMessageCount || 0) + 1;
    prelead.lastMessagePreview = cleanString(text, 180) || prelead.lastMessagePreview;
    prelead.whatsappFromLast4 = prelead.whatsappFromLast4 || phoneLast4(normalizedPhone);
    prelead.whatsappFromHash = prelead.whatsappFromHash || phoneHash || '';
    prelead.whatsappFromPhone = prelead.whatsappFromPhone || normalizedPhone || '';
    prelead.phone = prelead.phone || normalizedPhone || '';
    prelead.whatsappFrom = prelead.whatsappFrom || normalizedPhone || '';
    prelead.whatsappFromLid = prelead.whatsappFromLid || normalizedLid || '';
    prelead.whatsappFromJid = prelead.whatsappFromJid || normalizedJid || '';
    prelead.whatsappFromName = prelead.whatsappFromName || cleanString(senderName, 160) || '';
    prelead.updatedAt = nowIso();
  }

  let purchase = null;
  const countsAsPaymentProof = hasMedia && isPaymentProofMedia({ messageType, mimeType, fileName });
  if (countsAsPaymentProof) {
    purchase = await registerPaymentProof({
      agencyId,
      clientId,
      projectId,
      whatsappSessionId,
      phone: normalizedPhone,
      lid: normalizedLid,
      fromJid: normalizedJid,
      senderName,
      text,
      messageType,
      mimeType,
      fileName,
      source,
      messageId,
      prelead,
      allowPhoneAssociation,
      messageRecordId: messageRecord.id
    });
  }

  const resolvedProjectId = prelead?.projectId || projectId || '';
  const project = resolvedProjectId ? db.data.projects.find((p) => p.id === resolvedProjectId && p.agencyId === agencyId) : null;
  const resolvedClientId = prelead?.clientId || clientId || '';
  const client = resolvedClientId
    ? db.data.clients.find((c) => c.id === resolvedClientId && c.agencyId === agencyId)
    : null;

  pushEvent({
    agencyId,
    projectId: project?.id || null,
    type: 'incoming_message',
    message: `${messageType}${code ? ` con código ${code}` : ''}${countsAsPaymentProof ? ' con comprobante' : (hasMedia ? ' con archivo ignorado como comprobante' : '')}.`
  });

  await db.save();

  return {
    ok: true,
    message: messageRecord,
    lead: prelead || null,
    leadResult,
    purchase,
    project: project || null,
    client: client || null
  };
}

export async function registerPaymentProof({
  agencyId,
  clientId = '',
  projectId = '',
  whatsappSessionId = '',
  phone = '',
  lid = '',
  fromJid = '',
  senderName = '',
  text = '',
  messageType = 'document',
  mimeType = '',
  fileName = '',
  source = 'manual',
  messageId = '',
  prelead = null,
  allowPhoneAssociation = true,
  messageRecordId = null
}) {
  const normalizedPhone = normalizeLeadPhone(phone);
  const normalizedLid = cleanString(lid, 160);
  const normalizedJid = cleanString(fromJid, 180);
  const phoneHash = getSenderHash({ phone: normalizedPhone, lid: normalizedLid });
  const code = extractLeadCode(text);

  if (!prelead && code) {
    prelead = db.data.preleads.find((l) => l.code === code && l.agencyId === agencyId);
  }

  if (!prelead && phoneHash && allowPhoneAssociation) {
    prelead = findRecentLeadByPhone({ agencyId, phoneHash, whatsappSessionId, clientId });
  }

  const resolvedProjectId = prelead?.projectId || projectId || '';
  const project = resolvedProjectId ? db.data.projects.find((p) => p.id === resolvedProjectId && p.agencyId === agencyId) : null;

  const purchase = await db.insert('purchases', {
    agencyId,
    whatsappSessionId: whatsappSessionId || prelead?.whatsappSessionId || '',
    clientId: prelead?.clientId || clientId || null,
    projectId: prelead?.projectId || project?.id || null,
    preleadId: prelead?.id || null,
    code: prelead?.code || code || '',
    whatsappFromHash: phoneHash,
    whatsappFromLast4: phoneLast4(normalizedPhone),
    whatsappFromPhone: normalizedPhone,
    whatsappFromLid: normalizedLid,
    whatsappFromJid: normalizedJid,
    whatsappFromName: cleanString(senderName, 160),
    messageRecordId,
    externalMessageId: cleanString(messageId, 200),
    proofType: messageType,
    mimeType: cleanString(mimeType, 160),
    fileName: cleanString(fileName, 220),
    captionPreview: cleanString(text, 180),
    status: 'proof_received',
    validationStatus: 'pending',
    source,
    receivedAt: nowIso(),
    validatedAt: null,
    validatedBy: null,
    notes: ''
  });

  if (prelead) {
    prelead.purchaseStatus = 'proof_received';
    prelead.paymentProofReceivedAt = prelead.paymentProofReceivedAt || nowIso();
    prelead.whatsappFromLast4 = prelead.whatsappFromLast4 || phoneLast4(normalizedPhone);
    prelead.whatsappFromHash = prelead.whatsappFromHash || phoneHash || '';
    prelead.whatsappFromPhone = prelead.whatsappFromPhone || normalizedPhone || '';
    prelead.phone = prelead.phone || normalizedPhone || '';
    prelead.whatsappFrom = prelead.whatsappFrom || normalizedPhone || '';
    prelead.whatsappFromLid = prelead.whatsappFromLid || normalizedLid || '';
    prelead.whatsappFromJid = prelead.whatsappFromJid || normalizedJid || '';
    prelead.whatsappFromName = prelead.whatsappFromName || cleanString(senderName, 160) || '';
    prelead.updatedAt = nowIso();
  }

  pushEvent({
    agencyId,
    projectId: prelead?.projectId || project?.id || null,
    type: 'payment_proof_received',
    message: `Comprobante recibido${prelead?.code ? ` para ${prelead.code}` : ''}.`
  });

  await db.save();

  return purchase;
}

export async function updatePurchaseStatus({
  purchaseId,
  agencyId,
  status,
  notes = '',
  userId = '',
  value = 0,
  currency = 'ARS'
}) {
  const purchase = db.data.purchases.find((p) => p.id === purchaseId && (!agencyId || p.agencyId === agencyId));
  if (!purchase) {
    return { ok: false, status: 404, error: 'Comprobante no encontrado.' };
  }

  const allowed = ['proof_received', 'purchase_confirmed', 'rejected', 'duplicate'];
  if (!allowed.includes(status)) {
    return { ok: false, status: 400, error: 'Estado de comprobante inválido.' };
  }

  const previousStatus = purchase.status;
  purchase.status = status;
  purchase.validationStatus = status === 'purchase_confirmed' ? 'approved' : (status === 'proof_received' ? 'pending' : status);
  purchase.notes = cleanString(notes, 1000);
  purchase.value = Number.isFinite(Number(value)) ? Math.max(0, Number(value)) : Number(purchase.value || 0);
  purchase.value = Math.min(purchase.value, 1_000_000_000_000);
  const requestedCurrency = cleanString(currency || purchase.currency || 'ARS', 8).toUpperCase();
  purchase.currency = /^[A-Z]{3}$/.test(requestedCurrency) ? requestedCurrency : 'ARS';
  purchase.validatedAt = status === 'proof_received' ? null : nowIso();
  purchase.validatedBy = status === 'proof_received' ? null : userId;
  purchase.updatedAt = nowIso();

  const prelead = purchase.preleadId ? db.data.preleads.find((l) => l.id === purchase.preleadId) : null;
  if (prelead) {
    prelead.purchaseStatus = status;
    prelead.purchaseValidatedAt = purchase.validatedAt;
    prelead.updatedAt = nowIso();
  }

  pushEvent({
    agencyId: purchase.agencyId,
    projectId: purchase.projectId,
    type: 'purchase_status_updated',
    message: `Comprobante ${purchase.code || purchase.id} actualizado a ${status}.`
  });

  await db.save();

  let metaJob = null;
  const hasPurchaseJob = (db.data.conversionJobs || []).some((job) =>
    job.purchaseId === purchase.id && job.eventName === 'Purchase'
  );
  if (
    status === 'purchase_confirmed' &&
    prelead?.projectId &&
    purchase.value > 0 &&
    (previousStatus !== 'purchase_confirmed' || !hasPurchaseJob)
  ) {
    metaJob = await conversionQueue.enqueue({
      agencyId: purchase.agencyId,
      projectId: prelead.projectId,
      preleadId: prelead.id,
      purchaseId: purchase.id,
      eventName: 'Purchase',
      value: purchase.value,
      currency: purchase.currency
    });
  } else if (status === 'purchase_confirmed' && purchase.value <= 0) {
    purchase.metaStatus = 'skipped';
    purchase.metaSkipReason = 'Compra validada sin importe; no se envió Purchase a Meta.';
    await db.save();
  }

  return { ok: true, purchase, prelead, metaJob };
}
