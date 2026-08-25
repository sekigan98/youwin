import test from 'node:test';
import assert from 'node:assert/strict';
import crypto from 'node:crypto';
import {
  extractMetaWhatsAppMessages,
  verifyMetaWebhookSignature
} from '../src/services/metaWhatsAppWebhook.service.js';

test('valida X-Hub-Signature-256 usando el body original', () => {
  const rawBody = Buffer.from('{"object":"whatsapp_business_account"}');
  const appSecret = 'meta-app-secret';
  const signature = `sha256=${crypto.createHmac('sha256', appSecret).update(rawBody).digest('hex')}`;
  assert.equal(verifyMetaWebhookSignature({ rawBody, signature, appSecret }), true);
  assert.equal(verifyMetaWebhookSignature({ rawBody: Buffer.from('{}'), signature, appSecret }), false);
});

test('extrae ctwa_clid y metadatos del webhook oficial', () => {
  const records = extractMetaWhatsAppMessages({
    object: 'whatsapp_business_account',
    entry: [{
      id: 'WABA_1',
      changes: [{
        field: 'messages',
        value: {
          metadata: { phone_number_id: 'PHONE_1', display_phone_number: '5491100000000' },
          contacts: [{ wa_id: '5491123456789', profile: { name: 'Ana' } }],
          messages: [{
            id: 'wamid.1',
            from: '5491123456789',
            timestamp: '1787659200',
            type: 'text',
            text: { body: 'Hola' },
            referral: {
              source_type: 'ad',
              source_id: 'AD_123',
              source_url: 'https://fb.me/ad',
              ctwa_clid: 'ARAH-click-id'
            }
          }]
        }
      }]
    }]
  });

  assert.equal(records.length, 1);
  assert.deepEqual(records[0], {
    wabaId: 'WABA_1',
    phoneNumberId: 'PHONE_1',
    displayPhoneNumber: '5491100000000',
    messageId: 'wamid.1',
    from: '5491123456789',
    senderName: 'Ana',
    timestamp: '1787659200',
    messageType: 'text',
    text: 'Hola',
    hasMedia: false,
    mimeType: '',
    fileName: '',
    mediaId: '',
    ctwaClid: 'ARAH-click-id',
    sourceId: 'AD_123',
    sourceUrl: 'https://fb.me/ad',
    sourceType: 'ad'
  });
});
