import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs/promises';
import os from 'node:os';
import path from 'node:path';

test('un mismo mensaje de WhatsApp confirma un solo lead y una sola conversión', async () => {
  const tempDir = await fs.mkdtemp(path.join(os.tmpdir(), 'truelead-dedupe-'));
  process.env.DATA_FILE = path.join(tempDir, 'db.json');
  process.env.ADMIN_EMAIL = 'admin-dedupe@truelead.test';
  process.env.ADMIN_PASSWORD = 'TestAdminPassword123!';

  const { db } = await import('../src/lib/db.js');
  const { conversionQueue } = await import('../src/services/conversionQueue.service.js');
  const { registerIncomingWhatsAppMessage } = await import('../src/services/leadEvents.service.js');
  const { whatsappManager } = await import('../src/services/whatsappBaileys.service.js');

  try {
    await db.init();
    db.data.agencies.push({ id: 'agency_1', status: 'active', plan: 'pro' });
    db.data.clients.push({ id: 'client_1', agencyId: 'agency_1', name: 'Cliente' });
    db.data.projects.push({
      id: 'project_1',
      agencyId: 'agency_1',
      clientId: 'client_1',
      name: 'Landing',
      status: 'active'
    });
    db.data.preleads.push({
      id: 'prelead_1',
      agencyId: 'agency_1',
      clientId: 'client_1',
      projectId: 'project_1',
      code: 'TL-ABC234',
      status: 'intent',
      metaStatus: 'pending',
      createdAt: new Date().toISOString()
    });
    await db.save();

    const incoming = {
      agencyId: 'agency_1',
      clientId: 'client_1',
      whatsappSessionId: 'wa_1',
      messageId: 'wamid.same-message',
      from: '5491123456789',
      text: 'Hola, mi código es TL-ABC234',
      messageType: 'text',
      source: 'test'
    };

    const first = await registerIncomingWhatsAppMessage(incoming);
    const repeatedDelivery = await registerIncomingWhatsAppMessage(incoming);

    assert.equal(first.ok, true);
    assert.equal(repeatedDelivery.duplicate, true);
    assert.equal(db.data.whatsappMessages.filter((message) => message.externalMessageId === incoming.messageId).length, 1);
    assert.equal(db.data.preleads.filter((lead) => lead.code === 'TL-ABC234').length, 1);
    assert.equal(db.data.preleads.find((lead) => lead.code === 'TL-ABC234').status, 'confirmed');
    assert.equal(db.data.conversionJobs.filter((job) => job.preleadId === 'prelead_1' && job.eventName === 'Lead').length, 1);
    assert.equal(db.data.events.filter((event) => event.type === 'lead_confirmed').length, 1);

    db.data.whatsappSessions.push({ id: 'wa_qr_test', agencyId: 'agency_1', status: 'connecting' });
    const publicSession = await whatsappManager.updateSession('agency_1', 'wa_qr_test', {
      status: 'qr',
      qrDataUrl: 'data:image/png;base64,runtime-only'
    });
    assert.equal(publicSession.qrDataUrl, 'data:image/png;base64,runtime-only');
    assert.equal(db.data.whatsappSessions.find((session) => session.id === 'wa_qr_test').qrDataUrl, null);
    await whatsappManager.updateSession('agency_1', 'wa_qr_test', { qrDataUrl: null });
  } finally {
    conversionQueue.stop();
    await db.close();
    await fs.rm(tempDir, { recursive: true, force: true });
  }
});
