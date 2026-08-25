import crypto from 'node:crypto';

function safeEqual(left, right) {
  const a = Buffer.from(String(left || ''));
  const b = Buffer.from(String(right || ''));
  return a.length === b.length && a.length > 0 && crypto.timingSafeEqual(a, b);
}

export function verifyMetaWebhookSignature({ rawBody, signature, appSecret }) {
  if (!rawBody || !signature || !appSecret) return false;
  const body = Buffer.isBuffer(rawBody) ? rawBody : Buffer.from(rawBody);
  const expected = `sha256=${crypto.createHmac('sha256', appSecret).update(body).digest('hex')}`;
  return safeEqual(signature, expected);
}

function messageText(message = {}) {
  if (message.type === 'text') return message.text?.body || '';
  if (message.type === 'button') return message.button?.text || '';
  if (message.type === 'interactive') {
    return message.interactive?.button_reply?.title || message.interactive?.list_reply?.title || '';
  }
  const media = message[message.type] || {};
  return media.caption || '';
}

export function extractMetaWhatsAppMessages(payload = {}) {
  const records = [];
  for (const entry of Array.isArray(payload.entry) ? payload.entry : []) {
    for (const change of Array.isArray(entry.changes) ? entry.changes : []) {
      const value = change?.value || {};
      const contacts = new Map((Array.isArray(value.contacts) ? value.contacts : [])
        .map((contact) => [String(contact.wa_id || ''), contact]));

      for (const message of Array.isArray(value.messages) ? value.messages : []) {
        const media = message?.[message.type] || {};
        const contact = contacts.get(String(message.from || '')) || {};
        const referral = message.referral || {};
        records.push({
          wabaId: String(entry.id || value.metadata?.whatsapp_business_account_id || ''),
          phoneNumberId: String(value.metadata?.phone_number_id || ''),
          displayPhoneNumber: String(value.metadata?.display_phone_number || ''),
          messageId: String(message.id || ''),
          from: String(message.from || ''),
          senderName: String(contact.profile?.name || ''),
          timestamp: String(message.timestamp || ''),
          messageType: String(message.type || 'unknown'),
          text: String(messageText(message)),
          hasMedia: ['image', 'document', 'video', 'audio', 'sticker'].includes(message.type),
          mimeType: String(media.mime_type || ''),
          fileName: String(media.filename || ''),
          mediaId: String(media.id || ''),
          ctwaClid: String(referral.ctwa_clid || ''),
          sourceId: String(referral.source_id || ''),
          sourceUrl: String(referral.source_url || ''),
          sourceType: String(referral.source_type || '')
        });
      }
    }
  }
  return records;
}
