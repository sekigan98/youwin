import test from 'node:test';
import assert from 'node:assert/strict';
import {
  decryptSecret,
  encryptSecret,
  isEncryptedSecret,
  migrateEncryptedProjectSecrets
} from '../src/lib/secrets.js';

test('cifra y descifra tokens con AES-256-GCM', () => {
  const previous = process.env.DATA_ENCRYPTION_KEY;
  process.env.DATA_ENCRYPTION_KEY = 'test-key-with-at-least-thirty-two-characters-123';
  try {
    const encrypted = encryptSecret('EAAB-token-de-prueba');
    assert.equal(isEncryptedSecret(encrypted), true);
    assert.notEqual(encrypted, 'EAAB-token-de-prueba');
    assert.equal(decryptSecret(encrypted), 'EAAB-token-de-prueba');
  } finally {
    if (previous === undefined) delete process.env.DATA_ENCRYPTION_KEY;
    else process.env.DATA_ENCRYPTION_KEY = previous;
  }
});

test('migra tokens históricos en texto plano', () => {
  const previous = process.env.DATA_ENCRYPTION_KEY;
  process.env.DATA_ENCRYPTION_KEY = 'another-test-key-with-at-least-32-characters';
  try {
    const projects = [{ metaCapiToken: 'token-viejo' }, { metaCapiToken: '' }];
    assert.equal(migrateEncryptedProjectSecrets(projects), true);
    assert.equal(isEncryptedSecret(projects[0].metaCapiToken), true);
    assert.equal(decryptSecret(projects[0].metaCapiToken), 'token-viejo');
  } finally {
    if (previous === undefined) delete process.env.DATA_ENCRYPTION_KEY;
    else process.env.DATA_ENCRYPTION_KEY = previous;
  }
});
