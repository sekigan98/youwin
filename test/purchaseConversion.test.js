import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs/promises';
import os from 'node:os';
import path from 'node:path';

test('una compra validada sin importe puede encolar Purchase al agregar el importe después', async () => {
  const tempDir = await fs.mkdtemp(path.join(os.tmpdir(), 'truelead-purchase-'));
  process.env.DATA_FILE = path.join(tempDir, 'db.json');
  process.env.ADMIN_EMAIL = 'admin-purchase@truelead.test';
  process.env.ADMIN_PASSWORD = 'TestAdminPassword123!';

  const { db } = await import('../src/lib/db.js');
  const { conversionQueue } = await import('../src/services/conversionQueue.service.js');
  const { updatePurchaseStatus } = await import('../src/services/leadEvents.service.js');
  const originalEnqueue = conversionQueue.enqueue;
  const calls = [];

  try {
    await db.init();
    db.data.projects.push({ id: 'project_purchase', agencyId: 'agency_purchase' });
    db.data.preleads.push({
      id: 'lead_purchase',
      agencyId: 'agency_purchase',
      projectId: 'project_purchase',
      code: 'TL-BUY234',
      status: 'confirmed'
    });
    db.data.purchases.push({
      id: 'purchase_1',
      agencyId: 'agency_purchase',
      projectId: 'project_purchase',
      preleadId: 'lead_purchase',
      code: 'TL-BUY234',
      status: 'proof_received',
      value: 0,
      currency: 'ARS'
    });
    await db.save();

    conversionQueue.enqueue = async (payload) => {
      calls.push(payload);
      return { id: 'meta_purchase_1', status: 'pending', ...payload };
    };

    const withoutAmount = await updatePurchaseStatus({
      purchaseId: 'purchase_1',
      agencyId: 'agency_purchase',
      status: 'purchase_confirmed',
      value: 0,
      currency: 'ARS'
    });
    assert.equal(withoutAmount.purchase.metaStatus, 'skipped');
    assert.equal(calls.length, 0);

    const withAmount = await updatePurchaseStatus({
      purchaseId: 'purchase_1',
      agencyId: 'agency_purchase',
      status: 'purchase_confirmed',
      value: 125000,
      currency: 'ARS'
    });
    assert.equal(withAmount.metaJob.id, 'meta_purchase_1');
    assert.equal(calls.length, 1);
    assert.equal(calls[0].eventName, 'Purchase');
    assert.equal(calls[0].value, 125000);
  } finally {
    conversionQueue.enqueue = originalEnqueue;
    conversionQueue.stop();
    await db.close();
    await fs.rm(tempDir, { recursive: true, force: true });
  }
});
