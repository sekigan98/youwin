import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs/promises';
import os from 'node:os';
import path from 'node:path';

test('ctwa_clid crea y confirma un único lead desde Cloud API', async () => {
  const tempDir = await fs.mkdtemp(path.join(os.tmpdir(), 'truelead-cloud-'));
  process.env.DATA_FILE = path.join(tempDir, 'db.json');
  process.env.ADMIN_EMAIL = 'admin-cloud@truelead.test';
  process.env.ADMIN_PASSWORD = 'TestAdminPassword123!';

  const { db } = await import('../src/lib/db.js');
  const { conversionQueue } = await import('../src/services/conversionQueue.service.js');
  const { processMetaCloudMessage } = await import('../src/routes/prelead.routes.js');

  try {
    await db.init();
    db.data.agencies.push({
      id: 'agency_cloud', status: 'active', plan: 'pro', expiresAt: '2030-01-01T00:00:00.000Z'
    });
    db.data.clients.push({ id: 'client_cloud', agencyId: 'agency_cloud', name: 'Cliente Cloud' });
    db.data.projects.push({
      id: 'project_cloud',
      publicId: 'tl_cloud',
      agencyId: 'agency_cloud',
      clientId: 'client_cloud',
      name: 'Campaña directa',
      status: 'active',
      trackingMode: 'cloud_api',
      metaPhoneNumberId: 'PHONE_1',
      metaWabaId: 'WABA_1',
      metaAdIds: 'AD_1'
    });
    await db.save();

    const message = {
      wabaId: 'WABA_1',
      phoneNumberId: 'PHONE_1',
      displayPhoneNumber: '5491100000000',
      messageId: 'wamid.cloud.1',
      from: '5491123456789',
      senderName: 'Ana',
      messageType: 'text',
      text: 'Hola desde el anuncio',
      hasMedia: false,
      mimeType: '',
      fileName: '',
      ctwaClid: 'ARAH-unique-click',
      sourceId: 'AD_1',
      sourceUrl: 'https://fb.me/ad',
      sourceType: 'ad'
    };

    const first = await processMetaCloudMessage(message);
    const retriedWebhook = await processMetaCloudMessage(message);
    const lead = db.data.preleads.find((item) => item.ctwaClid === message.ctwaClid);

    assert.equal(first.ok, true);
    assert.equal(retriedWebhook.duplicate, true);
    assert.equal(lead.status, 'confirmed');
    assert.equal(lead.trackingMode, 'cloud_api');
    assert.equal(lead.metaAdId, 'AD_1');
    assert.equal(db.data.preleads.filter((item) => item.ctwaClid === message.ctwaClid).length, 1);
    assert.equal(db.data.whatsappMessages.filter((item) => item.externalMessageId === message.messageId).length, 1);
    assert.equal(db.data.conversionJobs.filter((item) => item.preleadId === lead.id && item.eventName === 'Lead').length, 1);

    db.data.agencies.push({
      id: 'agency_other', status: 'active', plan: 'pro', expiresAt: '2030-01-01T00:00:00.000Z'
    });
    db.data.clients.push({ id: 'client_other', agencyId: 'agency_other', name: 'Otro negocio' });
    db.data.projects.push({
      id: 'project_other',
      publicId: 'tl_other',
      agencyId: 'agency_other',
      clientId: 'client_other',
      name: 'Otro número',
      status: 'active',
      trackingMode: 'cloud_api',
      metaPhoneNumberId: 'PHONE_2',
      metaWabaId: 'WABA_2',
      metaAdIds: ''
    });
    await db.save();

    const sameSenderOtherBusiness = await processMetaCloudMessage({
      ...message,
      wabaId: 'WABA_2',
      phoneNumberId: 'PHONE_2',
      messageId: 'wamid.cloud.other-business',
      ctwaClid: '',
      sourceId: ''
    });
    assert.equal(sameSenderOtherBusiness.lead, null);
    assert.equal(sameSenderOtherBusiness.message.agencyId, 'agency_other');
    assert.equal(sameSenderOtherBusiness.message.projectId, 'project_other');
    assert.equal(db.data.preleads.filter((item) => item.agencyId === 'agency_other').length, 0);
  } finally {
    conversionQueue.stop();
    await db.close();
    await fs.rm(tempDir, { recursive: true, force: true });
  }
});
