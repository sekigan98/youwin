import crypto from 'node:crypto';

const PREFIX = 'enc:v1';

function keyMaterial() {
  const secret = String(process.env.DATA_ENCRYPTION_KEY || '').trim();
  if (!secret) return null;
  return crypto.createHash('sha256').update(secret).digest();
}

export function isEncryptedSecret(value) {
  return String(value || '').startsWith(`${PREFIX}:`);
}

export function encryptSecret(value) {
  const plaintext = String(value || '').trim();
  if (!plaintext || isEncryptedSecret(plaintext)) return plaintext;

  const key = keyMaterial();
  if (!key) return plaintext;

  const iv = crypto.randomBytes(12);
  const cipher = crypto.createCipheriv('aes-256-gcm', key, iv);
  const ciphertext = Buffer.concat([cipher.update(plaintext, 'utf8'), cipher.final()]);
  const tag = cipher.getAuthTag();

  return [PREFIX, iv.toString('base64url'), tag.toString('base64url'), ciphertext.toString('base64url')].join(':');
}

export function decryptSecret(value) {
  const stored = String(value || '').trim();
  if (!stored || !isEncryptedSecret(stored)) return stored;

  const key = keyMaterial();
  if (!key) throw new Error('DATA_ENCRYPTION_KEY no está configurada.');

  const [, , ivEncoded, tagEncoded, ciphertextEncoded] = stored.split(':');
  if (!ivEncoded || !tagEncoded || !ciphertextEncoded) throw new Error('Secreto cifrado inválido.');

  const decipher = crypto.createDecipheriv('aes-256-gcm', key, Buffer.from(ivEncoded, 'base64url'));
  decipher.setAuthTag(Buffer.from(tagEncoded, 'base64url'));
  const plaintext = Buffer.concat([
    decipher.update(Buffer.from(ciphertextEncoded, 'base64url')),
    decipher.final()
  ]);
  return plaintext.toString('utf8');
}

export function maskSecret(value) {
  return value ? '••••••••••••' : '';
}

export function migrateEncryptedProjectSecrets(projects = []) {
  let changed = false;
  for (const project of projects) {
    for (const field of ['metaCapiToken', 'metaAccessToken']) {
      if (project[field] && !isEncryptedSecret(project[field])) {
        const encrypted = encryptSecret(project[field]);
        if (encrypted !== project[field]) {
          project[field] = encrypted;
          changed = true;
        }
      }
    }
  }
  return changed;
}

