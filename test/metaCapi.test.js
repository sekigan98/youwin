import test from 'node:test';
import assert from 'node:assert/strict';
import { encryptSecret } from '../src/lib/secrets.js';
import { sendMetaConversionEvent } from '../src/services/metaCapi.service.js';

const encryptionKey = 'meta-test-encryption-key-with-32-plus-characters';

async function captureMetaRequest({ prelead, eventName = 'Lead', purchase = null, value = 0, testEventCode = '' }) {
  const previousFetch = global.fetch;
  const previousKey = process.env.DATA_ENCRYPTION_KEY;
  const previousVersion = process.env.META_API_VERSION;
  let captured;
  process.env.DATA_ENCRYPTION_KEY = encryptionKey;
  process.env.META_API_VERSION = 'v26.0';
  global.fetch = async (url, options) => {
    captured = { url, options, payload: JSON.parse(options.body) };
    return { ok: true, status: 200, json: async () => ({ events_received: 1 }) };
  };

  try {
    const project = {
      id: 'project_1',
      name: 'Landing agosto',
      domain: 'https://cliente.com',
      metaDatasetId: '123456789',
      metaCapiToken: encryptSecret('EAAB-secret-token'),
      metaCurrency: 'ARS',
      metaWabaId: '987654321'
    };
    const result = await sendMetaConversionEvent({
      project,
      prelead,
      purchase,
      phone: '5491123456789',
      eventName,
      value,
      currency: 'ARS',
      testEventCode
    });
    return { captured, result };
  } finally {
    global.fetch = previousFetch;
    if (previousKey === undefined) delete process.env.DATA_ENCRYPTION_KEY;
    else process.env.DATA_ENCRYPTION_KEY = previousKey;
    if (previousVersion === undefined) delete process.env.META_API_VERSION;
    else process.env.META_API_VERSION = previousVersion;
  }
}

test('envía el chat confirmado como Lead website sin filtrar el token en la URL', async () => {
  const { captured, result } = await captureMetaRequest({
    prelead: {
      id: 'lead_1',
      code: 'TL-ABC234',
      visitorId: 'visitor_1',
      landingUrl: 'https://cliente.com/landing',
      confirmedAt: '2026-08-25T12:00:00.000Z',
      ip: '203.0.113.10',
      userAgent: 'Test Browser',
      fbp: 'fb.1.123.456',
      fbc: 'fb.1.123.fbclid'
    },
    testEventCode: 'TEST_TRUELEAD'
  });

  assert.equal(result.ok, true);
  assert.equal(captured.url, 'https://graph.facebook.com/v26.0/123456789/events');
  assert.equal(captured.url.includes('access_token'), false);
  assert.equal(captured.options.headers.Authorization, 'Bearer EAAB-secret-token');
  assert.equal(captured.payload.test_event_code, 'TEST_TRUELEAD');
  const event = captured.payload.data[0];
  assert.equal(event.event_name, 'Lead');
  assert.equal(event.action_source, 'website');
  assert.equal(event.event_id, 'truelead_lead_lead_1');
  assert.equal(event.user_data.fbc, 'fb.1.123.fbclid');
  assert.match(event.user_data.ph, /^[a-f0-9]{64}$/);
});

test('usa LeadSubmitted y business_messaging cuando existe ctwa_clid oficial', async () => {
  const { captured } = await captureMetaRequest({
    prelead: {
      id: 'lead_ctwa',
      code: 'TL-CTWA22',
      confirmedAt: '2026-08-25T12:00:00.000Z',
      ctwaClid: 'ARAHofficialclickid',
      whatsappBusinessAccountId: '987654321'
    }
  });

  const event = captured.payload.data[0];
  assert.equal(event.event_name, 'LeadSubmitted');
  assert.equal(event.action_source, 'business_messaging');
  assert.equal(event.messaging_channel, 'whatsapp');
  assert.deepEqual(event.user_data, {
    whatsapp_business_account_id: '987654321',
    ctwa_clid: 'ARAHofficialclickid'
  });
});
