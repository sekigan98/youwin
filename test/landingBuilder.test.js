import test from 'node:test';
import assert from 'node:assert/strict';
import {
  buildLandingPackage,
  normalizeLandingAssets,
  normalizeLandingBuilderConfig
} from '../src/services/landingBuilder.service.js';

const project = {
  id: 'project-1',
  publicId: 'tl_TESTBUILDER',
  name: 'Proyecto Demo'
};

const pixel = 'data:image/png;base64,iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAYAAAAfFcSJAAAADUlEQVR42mNk+M/wHwAF/gL+3MxZ5wAAAABJRU5ErkJggg==';

test('normaliza el mensaje y el origen publicado del constructor', () => {
  const config = normalizeLandingBuilderConfig({
    brandName: 'Marca Demo',
    whatsappMessage: 'Hola, quiero información',
    publishedOrigin: 'https://demo.vercel.app/landing?utm_source=test'
  }, project);

  assert.match(config.whatsappMessage, /\{\{code\}\}/);
  assert.equal(config.publishedOrigin, 'https://demo.vercel.app');
});

test('genera una landing portable sin incluir un número de WhatsApp fijo', () => {
  const result = buildLandingPackage({
    input: {
      brandName: '<script>alert(1)</script>',
      headline: 'Una propuesta medible',
      whatsappMessage: 'Hola, código {{code}}'
    },
    project,
    appOrigin: 'https://app.truelead.com.ar',
    rawAssets: { logo: pixel }
  });

  const names = result.files.map((file) => file.name);
  const index = String(result.files.find((file) => file.name === 'index.html').data);
  assert.ok(names.includes('index.html'));
  assert.ok(names.includes('styles.css'));
  assert.ok(names.includes('vercel.json'));
  assert.ok(names.includes('_headers'));
  assert.ok(names.includes('assets/logo.png'));
  assert.ok(!names.includes('numeros.json'));
  assert.match(index, /data-project="tl_TESTBUILDER"/);
  assert.match(index, /https:\/\/app\.truelead\.com\.ar\/sdk\/truelead\.js/);
  assert.doesNotMatch(index, /549\d{8,}/);
  assert.doesNotMatch(index, /<script>alert\(1\)<\/script>/);
  assert.match(index, /&lt;script&gt;alert\(1\)&lt;\/script&gt;/);
});

test('rechaza contenido que declara imagen pero no tiene su firma binaria', () => {
  assert.throws(
    () => normalizeLandingAssets({ hero: 'data:image/png;base64,SG9sYQ==' }),
    /no coincide con su formato/
  );
});
