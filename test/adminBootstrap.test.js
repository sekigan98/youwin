import test from 'node:test';
import assert from 'node:assert/strict';
import bcrypt from 'bcryptjs';
import fs from 'node:fs/promises';
import os from 'node:os';
import path from 'node:path';

test('ADMIN_PASSWORD rota la contraseña del administrador existente', async () => {
  const tempDir = await fs.mkdtemp(path.join(os.tmpdir(), 'truelead-admin-'));
  process.env.DATA_FILE = path.join(tempDir, 'db.json');
  process.env.ADMIN_EMAIL = 'admin-rotation@truelead.test';
  process.env.ADMIN_PASSWORD = 'InitialAdminPassword123';

  const { db } = await import('../src/lib/db.js');
  try {
    await db.init();
    let admin = db.data.users.find((user) => user.email === process.env.ADMIN_EMAIL);
    assert.equal(await bcrypt.compare('InitialAdminPassword123', admin.passwordHash), true);

    process.env.ADMIN_PASSWORD = 'RotatedAdminPassword456';
    await db.ensureAdmin();
    admin = db.data.users.find((user) => user.email === process.env.ADMIN_EMAIL);
    assert.equal(await bcrypt.compare('InitialAdminPassword123', admin.passwordHash), false);
    assert.equal(await bcrypt.compare('RotatedAdminPassword456', admin.passwordHash), true);
  } finally {
    await db.close();
    await fs.rm(tempDir, { recursive: true, force: true });
  }
});
