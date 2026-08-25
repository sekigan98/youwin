import { decryptSecret } from '../lib/secrets.js';
import { sha256 } from '../lib/utils.js';

function stripMasked(value) {
  if (!value || String(value).includes('•')) return '';
  return String(value).trim();
}

function unixTime(value) {
  const timestamp = value ? new Date(value).getTime() : Date.now();
  return Math.floor((Number.isFinite(timestamp) ? timestamp : Date.now()) / 1000);
}

function eventIdentifier({ eventName, prelead, purchase }) {
  const recordId = purchase?.id || prelead?.id || prelead?.code || 'unknown';
  return `truelead_${String(eventName || 'event').toLowerCase()}_${recordId}`;
}

function projectEventSource(project) {
  const candidate = String(project?.domain || '').split(/[\s,;]+/).find(Boolean)?.replace('*.', '') || '';
  try {
    const url = new URL(/^https?:\/\//i.test(candidate) ? candidate : `https://${candidate}`);
    return ['http:', 'https:'].includes(url.protocol) ? url.origin : '';
  } catch {
    return '';
  }
}

function websitePayload({ eventName, project, prelead, purchase, phone, value, currency }) {
  const userData = {
    client_ip_address: prelead?.ip || undefined,
    client_user_agent: prelead?.userAgent || undefined,
    fbp: prelead?.fbp || undefined,
    fbc: prelead?.fbc || undefined,
    ph: phone ? sha256(phone) : undefined,
    external_id: sha256(prelead?.visitorId || prelead?.code || purchase?.id)
  };
  Object.keys(userData).forEach((key) => userData[key] === undefined && delete userData[key]);

  const event = {
    event_name: eventName,
    event_time: unixTime(purchase?.validatedAt || prelead?.confirmedAt || prelead?.createdAt),
    event_id: eventIdentifier({ eventName, prelead, purchase }),
    action_source: 'website',
    event_source_url: prelead?.landingUrl || projectEventSource(project) || process.env.APP_URL,
    user_data: userData,
    custom_data: {
      content_name: eventName === 'Purchase' ? 'Compra validada en TrueLead' : 'Conversación real de WhatsApp',
      content_category: eventName === 'Purchase' ? 'whatsapp_purchase_confirmed' : 'whatsapp_message_confirmed',
      lead_code: prelead?.code || purchase?.code || '',
      project_id: project?.id || '',
      project_name: project?.name || '',
      value: Number.isFinite(Number(value)) ? Number(value) : 0,
      currency: currency || project?.metaCurrency || 'ARS'
    }
  };
  return event;
}

function businessMessagingPayload({ eventName, project, prelead, purchase, value, currency }) {
  const normalizedName = eventName === 'Lead' ? 'LeadSubmitted' : eventName;
  const wabaId = stripMasked(prelead?.whatsappBusinessAccountId || project?.metaWabaId);
  const ctwaClid = stripMasked(prelead?.ctwaClid);
  const event = {
    event_name: normalizedName,
    event_time: unixTime(purchase?.validatedAt || prelead?.confirmedAt || prelead?.createdAt),
    event_id: eventIdentifier({ eventName: normalizedName, prelead, purchase }),
    action_source: 'business_messaging',
    messaging_channel: 'whatsapp',
    user_data: {
      whatsapp_business_account_id: wabaId,
      ctwa_clid: ctwaClid
    }
  };

  if (normalizedName === 'Purchase') {
    event.custom_data = {
      value: Number.isFinite(Number(value)) ? Number(value) : 0,
      currency: currency || project?.metaCurrency || 'ARS',
      order_id: purchase?.id || prelead?.code || ''
    };
  }
  return event;
}

export async function sendMetaConversionEvent({
  project,
  prelead,
  purchase = null,
  phone = '',
  eventName = 'Lead',
  value = 0,
  currency = '',
  testEventCode = ''
}) {
  const datasetId = stripMasked(project?.metaDatasetId || project?.metaPixelId || process.env.META_DATASET_ID || process.env.META_PIXEL_ID);
  const encryptedToken = project?.metaCapiToken || project?.metaAccessToken || process.env.META_CAPI_ACCESS_TOKEN;
  let accessToken = '';
  try {
    accessToken = stripMasked(decryptSecret(encryptedToken));
  } catch (error) {
    return { ok: false, retryable: false, error: `No se pudo descifrar el token de Meta: ${error.message}` };
  }
  const configuredVersion = String(process.env.META_API_VERSION || 'v26.0');
  const apiVersion = /^v\d+\.\d+$/.test(configuredVersion) ? configuredVersion : 'v26.0';

  if (!datasetId || !accessToken) {
    return { skipped: true, reason: 'Falta Dataset ID o token de Meta CAPI.' };
  }

  const isBusinessMessaging = Boolean(prelead?.ctwaClid && (prelead?.whatsappBusinessAccountId || project?.metaWabaId));
  const event = isBusinessMessaging
    ? businessMessagingPayload({ eventName, project, prelead, purchase, value, currency })
    : websitePayload({ eventName, project, prelead, purchase, phone, value, currency });

  const payload = { data: [event] };
  const finalTestCode = testEventCode || project?.metaTestEventCode || process.env.META_TEST_EVENT_CODE;
  if (finalTestCode) payload.test_event_code = finalTestCode;

  const controller = new AbortController();
  const configuredTimeout = Number(process.env.META_REQUEST_TIMEOUT_MS || 10_000);
  const timeoutMs = Number.isFinite(configuredTimeout)
    ? Math.max(1000, Math.min(60_000, configuredTimeout))
    : 10_000;
  const timeout = setTimeout(() => controller.abort(), timeoutMs);
  const url = `https://graph.facebook.com/${apiVersion}/${encodeURIComponent(datasetId)}/events`;

  try {
    const response = await fetch(url, {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        Authorization: `Bearer ${accessToken}`
      },
      body: JSON.stringify(payload),
      signal: controller.signal
    });
    const result = await response.json().catch(() => ({}));

    if (!response.ok) {
      const retryAfterSeconds = Number(response.headers?.get?.('retry-after') || 0);
      return {
        ok: false,
        status: response.status,
        retryable: response.status === 429 || response.status >= 500,
        retryAfterSeconds: Number.isFinite(retryAfterSeconds) ? retryAfterSeconds : 0,
        result,
        eventId: event.event_id,
        eventName: event.event_name,
        source: event.action_source
      };
    }

    return {
      ok: true,
      status: response.status,
      result,
      eventId: event.event_id,
      eventName: event.event_name,
      source: event.action_source
    };
  } catch (error) {
    return {
      ok: false,
      status: 0,
      retryable: true,
      error: error.name === 'AbortError' ? 'Meta no respondió antes del timeout.' : error.message,
      eventId: event.event_id,
      eventName: event.event_name,
      source: event.action_source
    };
  } finally {
    clearTimeout(timeout);
  }
}

// Compatibilidad con integraciones internas anteriores.
export function sendMetaLeadEvent(args) {
  return sendMetaConversionEvent({ ...args, eventName: 'Lead' });
}
