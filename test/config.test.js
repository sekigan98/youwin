import test from 'node:test';
import assert from 'node:assert/strict';
import { spawnSync } from 'node:child_process';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const projectRoot = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
const validationScript = "import('./src/config.js').then(({ validateRuntimeConfig }) => validateRuntimeConfig())";

function productionEnv(overrides = {}) {
  const env = {
    ...process.env,
    NODE_ENV: 'production',
    JWT_SECRET: 'test-jwt-secret-with-at-least-thirty-two-characters',
    ADMIN_PASSWORD: 'TestAdminPass-2026',
    DATA_ENCRYPTION_KEY: 'test-encryption-key-with-at-least-thirty-two-characters',
    APP_URL: 'https://app.truelead.com.ar',
    CORS_ORIGIN: 'https://app.truelead.com.ar,https://truelead.com.ar',
    WHATSAPP_ALLOW_DEMO_CONNECT: 'false',
    META_APP_SECRET: '',
    META_WHATSAPP_VERIFY_TOKEN: '',
    WHATSAPP_WEBHOOK_SECRET: '',
    ...overrides
  };
  return env;
}

function validateInChild(env) {
  return spawnSync(process.execPath, ['--input-type=module', '--eval', validationScript], {
    cwd: projectRoot,
    env,
    encoding: 'utf8'
  });
}

test('producción puede iniciar sin el webhook genérico opcional', () => {
  const result = validateInChild(productionEnv());
  assert.equal(result.status, 0, result.stderr);
});

test('producción rechaza un secreto débil cuando el webhook genérico se habilita', () => {
  const result = validateInChild(productionEnv({ WHATSAPP_WEBHOOK_SECRET: 'corto' }));
  assert.notEqual(result.status, 0);
  assert.match(result.stderr, /WHATSAPP_WEBHOOK_SECRET/);
});
