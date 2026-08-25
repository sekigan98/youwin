import test from 'node:test';
import assert from 'node:assert/strict';
import {
  extractLeadCode,
  normalizeAuthorizedDomains,
  normalizeLeadPhone,
  normalizeWhatsAppNumber,
  omitSensitiveProject,
  originMatchesAuthorizedDomains,
  parseDateRange,
  publicCode,
  sha256Exact
} from '../src/lib/utils.js';

test('genera códigos TL con entropía y formato estable', () => {
  const codes = new Set(Array.from({ length: 200 }, () => publicCode('TL', 6)));
  assert.equal(codes.size, 200);
  for (const code of codes) assert.match(code, /^TL-[A-HJ-NP-Z2-9]{6}$/);
});

test('el rango personalizado respeta el huso horario del navegador', () => {
  const range = parseDateRange({
    range: 'custom',
    from: '2026-08-25',
    to: '2026-08-25',
    tzOffsetMinutes: '180'
  });
  assert.equal(range.from, '2026-08-25T03:00:00.000Z');
  assert.equal(range.to, '2026-08-26T02:59:59.999Z');
});

test('el hash de tokens conserva mayúsculas y minúsculas', () => {
  assert.notEqual(sha256Exact('TokenABC'), sha256Exact('tokenabc'));
});

test('extrae un código TL sin distinguir mayúsculas', () => {
  assert.equal(extractLeadCode('Hola, mi código es tl-4f9k2q. Gracias'), 'TL-4F9K2Q');
  assert.equal(extractLeadCode('Mensaje sin identificador'), null);
});

test('normaliza el suffix de dispositivo de Baileys sin alterar el teléfono', () => {
  assert.equal(normalizeWhatsAppNumber('5491124649559:2@s.whatsapp.net'), '5491124649559');
  assert.equal(normalizeLeadPhone('162882893422688@lid'), '');
  assert.equal(normalizeLeadPhone('+54 9 11 2464-9559'), '5491124649559');
  assert.equal(normalizeLeadPhone('+49 151 2345678901'), '491512345678901');
  assert.equal(normalizeLeadPhone('123'), '');
});

test('la whitelist respeta origen exacto y subdominios autorizados', () => {
  const allowed = normalizeAuthorizedDomains(`
    https://cliente.com
    *.campanas.cliente.com
    https://cliente.com/
  `);

  assert.equal(allowed, 'https://cliente.com\n*.campanas.cliente.com');
  assert.equal(originMatchesAuthorizedDomains('https://cliente.com/landing', allowed), true);
  assert.equal(originMatchesAuthorizedDomains('https://agosto.campanas.cliente.com', allowed), true);
  assert.equal(originMatchesAuthorizedDomains('http://agosto.campanas.cliente.com', allowed), false);
  assert.equal(originMatchesAuthorizedDomains('https://cliente.com.evil.example', allowed), false);
  assert.equal(originMatchesAuthorizedDomains('https://otro.com', allowed), false);
});

test('los proyectos públicos no exponen tokens ni QR persistido', () => {
  const project = omitSensitiveProject({
    id: 'p1',
    metaCapiToken: 'secreto',
    whatsappSession: { id: 'wa1', qr: 'data:image/png;base64,secreto' }
  });

  assert.equal(project.metaCapiConfigured, true);
  assert.equal('metaCapiToken' in project, false);
  assert.equal(project.whatsappSession.qr, null);
});
