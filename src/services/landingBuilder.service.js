import path from 'node:path';
import { cleanString, normalizeOrigin } from '../lib/utils.js';

const IMAGE_TYPES = new Map([
  ['image/png', { extension: 'png', signature: (buffer) => buffer.subarray(0, 8).equals(Buffer.from('89504e470d0a1a0a', 'hex')) }],
  ['image/jpeg', { extension: 'jpg', signature: (buffer) => buffer[0] === 0xff && buffer[1] === 0xd8 && buffer[2] === 0xff }],
  ['image/webp', { extension: 'webp', signature: (buffer) => buffer.subarray(0, 4).toString() === 'RIFF' && buffer.subarray(8, 12).toString() === 'WEBP' }],
  ['image/gif', { extension: 'gif', signature: (buffer) => ['GIF87a', 'GIF89a'].includes(buffer.subarray(0, 6).toString()) }],
  ['image/x-icon', { extension: 'ico', signature: (buffer) => buffer.subarray(0, 4).equals(Buffer.from('00000100', 'hex')) }],
  ['image/vnd.microsoft.icon', { extension: 'ico', signature: (buffer) => buffer.subarray(0, 4).equals(Buffer.from('00000100', 'hex')) }]
]);

const ASSET_RULES = {
  favicon: { maxBytes: 512 * 1024, allowIcon: true },
  logo: { maxBytes: 2 * 1024 * 1024 },
  hero: { maxBytes: 4 * 1024 * 1024 },
  gallery1: { maxBytes: 2 * 1024 * 1024 },
  gallery2: { maxBytes: 2 * 1024 * 1024 },
  gallery3: { maxBytes: 2 * 1024 * 1024 }
};

const THEMES = {
  midnight: {
    background: '#07101f',
    surface: '#101c33',
    accent: '#4de0ae',
    accentSecondary: '#74a7ff',
    text: '#f5f8ff',
    muted: '#aebbd3'
  },
  ocean: {
    background: '#061723',
    surface: '#0e2937',
    accent: '#37d7ff',
    accentSecondary: '#4387ff',
    text: '#f4fbff',
    muted: '#a9c8d5'
  },
  ember: {
    background: '#1b0b0d',
    surface: '#30151a',
    accent: '#ffb84d',
    accentSecondary: '#ff5f6d',
    text: '#fff8f1',
    muted: '#d8b9b4'
  },
  light: {
    background: '#f4f7fb',
    surface: '#ffffff',
    accent: '#1167e8',
    accentSecondary: '#09a77c',
    text: '#14213d',
    muted: '#586780'
  }
};

function html(value = '') {
  return String(value)
    .replaceAll('&', '&amp;')
    .replaceAll('<', '&lt;')
    .replaceAll('>', '&gt;')
    .replaceAll('"', '&quot;')
    .replaceAll("'", '&#39;');
}

function attribute(value = '') {
  return html(value).replaceAll('\n', '&#10;').replaceAll('\r', '');
}

function text(value, max, fallback = '') {
  return cleanString(value, max) || fallback;
}

function color(value, fallback) {
  const candidate = String(value || '').trim();
  return /^#[0-9a-f]{6}$/i.test(candidate) ? candidate.toLowerCase() : fallback;
}

function boolean(value, fallback = false) {
  if (typeof value === 'boolean') return value;
  if (value === 'true' || value === '1' || value === 1) return true;
  if (value === 'false' || value === '0' || value === 0) return false;
  return fallback;
}

function trackingId(value, kind) {
  const candidate = cleanString(value, 80);
  if (!candidate) return '';
  if (kind === 'google') return /^G-[A-Z0-9]{5,20}$/i.test(candidate) ? candidate.toUpperCase() : '';
  return /^\d{5,30}$/.test(candidate) ? candidate : '';
}

function safeWhatsappMessage(value) {
  const message = text(value, 700, 'Hola, quiero recibir información. Mi código es: {{code}}');
  return message.includes('{{code}}') ? message : `${message} Mi código es: {{code}}`;
}

function defaultFeature(index) {
  return [
    { icon: '✓', title: 'Atención directa', copy: 'La consulta llega al WhatsApp correcto, sin pasos innecesarios.' },
    { icon: '⚡', title: 'Respuesta simple', copy: 'El mensaje queda preparado para que la persona solo tenga que enviarlo.' },
    { icon: '↗', title: 'Conversión medible', copy: 'TrueLead registra la intención y confirma el chat cuando realmente llega.' }
  ][index];
}

export function defaultLandingBuilderConfig(project = {}) {
  const brand = text(project.name, 80, 'Mi negocio');
  const theme = THEMES.midnight;
  return {
    schemaVersion: 1,
    layout: 'split',
    theme: 'midnight',
    brandName: brand,
    pageTitle: `${brand} | Atención por WhatsApp`,
    metaDescription: `Conocé ${brand} y consultanos directamente por WhatsApp.`,
    badge: 'Atención directa por WhatsApp',
    headline: 'Todo empieza con una conversación simple',
    description: 'Conocé nuestra propuesta y escribinos por WhatsApp. Te dejamos el mensaje preparado para que puedas consultar en segundos.',
    ctaLabel: 'Hablar por WhatsApp',
    whatsappMessage: 'Hola, quiero recibir información. Mi código es: {{code}}',
    sectionTitle: 'Una experiencia clara, rápida y medible',
    sectionCopy: 'Mostrá los beneficios principales de tu propuesta y llevá cada consulta al WhatsApp vinculado en TrueLead.',
    finalTitle: '¿Querés recibir más información?',
    finalCopy: 'Tocá el botón para abrir WhatsApp con el mensaje preparado.',
    footerText: brand,
    legalNotice: '',
    publishedOrigin: '',
    metaPixelId: '',
    googleAnalyticsId: '',
    showStickyCta: true,
    colors: { ...theme },
    features: [0, 1, 2].map(defaultFeature)
  };
}

export function normalizeLandingBuilderConfig(input = {}, project = {}) {
  const defaults = defaultLandingBuilderConfig(project);
  const themeName = ['midnight', 'ocean', 'ember', 'light'].includes(cleanString(input.theme, 20))
    ? cleanString(input.theme, 20)
    : defaults.theme;
  const palette = THEMES[themeName];
  const rawFeatures = Array.isArray(input.features) ? input.features : [];
  const features = [0, 1, 2].map((index) => {
    const fallback = defaults.features[index];
    const feature = rawFeatures[index] || {};
    return {
      icon: text(feature.icon, 8, fallback.icon),
      title: text(feature.title, 80, fallback.title),
      copy: text(feature.copy, 240, fallback.copy)
    };
  });

  return {
    schemaVersion: 1,
    layout: ['split', 'centered', 'editorial'].includes(cleanString(input.layout, 20))
      ? cleanString(input.layout, 20)
      : defaults.layout,
    theme: themeName,
    brandName: text(input.brandName, 80, defaults.brandName),
    pageTitle: text(input.pageTitle, 120, defaults.pageTitle),
    metaDescription: text(input.metaDescription, 240, defaults.metaDescription),
    badge: text(input.badge, 100, defaults.badge),
    headline: text(input.headline, 180, defaults.headline),
    description: text(input.description, 500, defaults.description),
    ctaLabel: text(input.ctaLabel, 80, defaults.ctaLabel),
    whatsappMessage: safeWhatsappMessage(input.whatsappMessage),
    sectionTitle: text(input.sectionTitle, 150, defaults.sectionTitle),
    sectionCopy: text(input.sectionCopy, 400, defaults.sectionCopy),
    finalTitle: text(input.finalTitle, 150, defaults.finalTitle),
    finalCopy: text(input.finalCopy, 300, defaults.finalCopy),
    footerText: text(input.footerText, 120, defaults.footerText),
    legalNotice: cleanString(input.legalNotice, 500),
    publishedOrigin: normalizeOrigin(input.publishedOrigin),
    metaPixelId: trackingId(input.metaPixelId, 'meta'),
    googleAnalyticsId: trackingId(input.googleAnalyticsId, 'google'),
    showStickyCta: boolean(input.showStickyCta, true),
    colors: {
      background: color(input.colors?.background, palette.background),
      surface: color(input.colors?.surface, palette.surface),
      accent: color(input.colors?.accent, palette.accent),
      accentSecondary: color(input.colors?.accentSecondary, palette.accentSecondary),
      text: color(input.colors?.text, palette.text),
      muted: color(input.colors?.muted, palette.muted)
    },
    features
  };
}

function decodeImageDataUrl(dataUrl, slot) {
  if (!dataUrl) return null;
  const rule = ASSET_RULES[slot];
  if (!rule) throw new Error(`Asset no permitido: ${slot}.`);
  const match = String(dataUrl).match(/^data:(image\/[a-z0-9.+-]+);base64,([a-z0-9+/=\s]+)$/i);
  if (!match) throw new Error(`El archivo ${slot} no es una imagen válida.`);

  const mimeType = match[1].toLowerCase();
  const imageType = IMAGE_TYPES.get(mimeType);
  if (!imageType || (!rule.allowIcon && imageType.extension === 'ico')) {
    throw new Error(`Formato no permitido para ${slot}. Usá PNG, JPG, WEBP o GIF.`);
  }

  const buffer = Buffer.from(match[2].replace(/\s/g, ''), 'base64');
  if (!buffer.length || buffer.length > rule.maxBytes) {
    throw new Error(`La imagen ${slot} supera el tamaño permitido.`);
  }
  if (!imageType.signature(buffer)) throw new Error(`El contenido de ${slot} no coincide con su formato.`);

  const filename = `assets/${slot}.${imageType.extension}`;
  return { filename, buffer, mimeType };
}

export function normalizeLandingAssets(input = {}) {
  const assets = {};
  let totalBytes = 0;
  for (const slot of Object.keys(ASSET_RULES)) {
    const decoded = decodeImageDataUrl(input[slot], slot);
    if (decoded) {
      totalBytes += decoded.buffer.length;
      if (totalBytes > 13 * 1024 * 1024) throw new Error('Las imágenes de la landing superan 13 MB en total.');
      assets[slot] = decoded;
    }
  }
  return assets;
}

function featureCards(config) {
  return config.features.map((feature) => `
      <article class="feature-card reveal">
        <span class="feature-icon" aria-hidden="true">${html(feature.icon)}</span>
        <h3>${html(feature.title)}</h3>
        <p>${html(feature.copy)}</p>
      </article>`).join('');
}

function galleryMarkup(assets) {
  const images = ['gallery1', 'gallery2', 'gallery3'].filter((key) => assets[key]);
  if (!images.length) return '';
  return `
    <section class="section gallery-section" aria-label="Galería">
      <div class="gallery-grid">
        ${images.map((key, index) => `<img src="${attribute(assets[key].filename)}" alt="Imagen ${index + 1} de la propuesta" loading="lazy">`).join('\n')}
      </div>
    </section>`;
}

function trackingScript(config) {
  if (!config.metaPixelId && !config.googleAnalyticsId) return '';
  return `(() => {
  ${config.metaPixelId ? `
  window.fbq = window.fbq || function(){ (window.fbq.q = window.fbq.q || []).push(arguments); };
  window.fbq.loaded = true;
  window.fbq.version = '2.0';
  const metaScript = document.createElement('script');
  metaScript.async = true;
  metaScript.src = 'https://connect.facebook.net/en_US/fbevents.js';
  document.head.appendChild(metaScript);
  window.fbq('init', ${JSON.stringify(config.metaPixelId)});
  window.fbq('track', 'PageView');` : ''}
  ${config.googleAnalyticsId ? `
  window.dataLayer = window.dataLayer || [];
  window.gtag = window.gtag || function(){ window.dataLayer.push(arguments); };
  window.gtag('js', new Date());
  window.gtag('config', ${JSON.stringify(config.googleAnalyticsId)});
  const googleScript = document.createElement('script');
  googleScript.async = true;
  googleScript.src = 'https://www.googletagmanager.com/gtag/js?id=' + encodeURIComponent(${JSON.stringify(config.googleAnalyticsId)});
  document.head.appendChild(googleScript);` : ''}
})();\n`;
}

function appScript() {
  return `document.querySelectorAll('[data-current-year]').forEach((node) => {
  node.textContent = String(new Date().getFullYear());
});

if ('IntersectionObserver' in window) {
  const observer = new IntersectionObserver((entries) => {
    for (const entry of entries) {
      if (entry.isIntersecting) {
        entry.target.classList.add('is-visible');
        observer.unobserve(entry.target);
      }
    }
  }, { threshold: 0.12 });
  document.querySelectorAll('.reveal').forEach((element) => observer.observe(element));
} else {
  document.querySelectorAll('.reveal').forEach((element) => element.classList.add('is-visible'));
}\n`;
}

function buildLandingHtml({ config, project, assets, appOrigin }) {
  const favicon = assets.favicon?.filename;
  const logo = assets.logo?.filename;
  const hero = assets.hero?.filename;
  const ogImage = config.publishedOrigin && hero
    ? `${config.publishedOrigin}/${hero}`
    : '';
  const tracking = Boolean(config.metaPixelId || config.googleAnalyticsId);

  return `<!doctype html>
<html lang="es">
<head>
  <meta charset="utf-8">
  <meta name="viewport" content="width=device-width, initial-scale=1">
  <title>${html(config.pageTitle)}</title>
  <meta name="description" content="${attribute(config.metaDescription)}">
  <meta name="theme-color" content="${attribute(config.colors.background)}">
  <meta property="og:type" content="website">
  <meta property="og:title" content="${attribute(config.pageTitle)}">
  <meta property="og:description" content="${attribute(config.metaDescription)}">
  ${config.publishedOrigin ? `<link rel="canonical" href="${attribute(config.publishedOrigin)}/">` : ''}
  ${ogImage ? `<meta property="og:image" content="${attribute(ogImage)}">` : ''}
  ${favicon ? `<link rel="icon" href="${attribute(favicon)}">` : ''}
  <link rel="stylesheet" href="styles.css">
</head>
<body class="layout-${attribute(config.layout)}">
  <header class="site-header">
    <a class="brand" href="#inicio" aria-label="Ir al inicio">
      ${logo ? `<img src="${attribute(logo)}" alt="${attribute(config.brandName)}">` : `<span class="brand-mark" aria-hidden="true">${html(config.brandName.slice(0, 1).toUpperCase())}</span>`}
      <strong>${html(config.brandName)}</strong>
    </a>
    <a class="header-cta" href="#" data-truelead-whatsapp data-truelead-source="nav" data-truelead-message="${attribute(config.whatsappMessage)}">${html(config.ctaLabel)}</a>
  </header>

  <main id="inicio">
    <section class="hero">
      <div class="hero-copy reveal">
        <span class="eyebrow">${html(config.badge)}</span>
        <h1>${html(config.headline)}</h1>
        <p class="hero-description">${html(config.description)}</p>
        <div class="hero-actions">
          <a class="primary-cta" href="#" data-truelead-whatsapp data-truelead-source="hero" data-truelead-message="${attribute(config.whatsappMessage)}">${html(config.ctaLabel)} <span aria-hidden="true">↗</span></a>
          <a class="secondary-cta" href="#beneficios">Ver más</a>
        </div>
        <p class="microcopy"><span aria-hidden="true">●</span> El número de destino se administra desde TrueLead.</p>
      </div>
      <div class="hero-visual reveal">
        ${hero
          ? `<img src="${attribute(hero)}" alt="${attribute(config.brandName)}" fetchpriority="high">`
          : `<div class="value-stack">
              ${config.features.map((feature) => `<div><span>${html(feature.icon)}</span><strong>${html(feature.title)}</strong></div>`).join('')}
            </div>`}
      </div>
    </section>

    <section class="section intro" id="beneficios">
      <div class="section-heading reveal">
        <span class="eyebrow">Por qué elegirnos</span>
        <h2>${html(config.sectionTitle)}</h2>
        <p>${html(config.sectionCopy)}</p>
      </div>
      <div class="feature-grid">${featureCards(config)}</div>
    </section>

    <section class="section steps-section">
      <div class="section-heading reveal">
        <span class="eyebrow">Cómo funciona</span>
        <h2>De la landing a WhatsApp en tres pasos</h2>
      </div>
      <ol class="steps">
        <li class="reveal"><span>1</span><div><strong>Conocé la propuesta</strong><p>Revisá la información principal desde cualquier dispositivo.</p></div></li>
        <li class="reveal"><span>2</span><div><strong>Tocá el botón</strong><p>TrueLead prepara un mensaje con un código único para esta consulta.</p></div></li>
        <li class="reveal"><span>3</span><div><strong>Enviá el WhatsApp</strong><p>La conversación se confirma cuando el mensaje llega al número vinculado.</p></div></li>
      </ol>
    </section>

    ${galleryMarkup(assets)}

    <section class="section final-cta reveal">
      <div>
        <span class="eyebrow">Estamos para ayudarte</span>
        <h2>${html(config.finalTitle)}</h2>
        <p>${html(config.finalCopy)}</p>
      </div>
      <a class="primary-cta" href="#" data-truelead-whatsapp data-truelead-source="final" data-truelead-message="${attribute(config.whatsappMessage)}">${html(config.ctaLabel)} <span aria-hidden="true">↗</span></a>
    </section>
  </main>

  <footer>
    <p>© <span data-current-year></span> ${html(config.footerText)}</p>
    ${config.legalNotice ? `<p class="legal">${html(config.legalNotice)}</p>` : ''}
  </footer>

  ${config.showStickyCta ? `<a class="sticky-cta" href="#" data-truelead-whatsapp data-truelead-source="sticky" data-truelead-message="${attribute(config.whatsappMessage)}"><span>${html(config.ctaLabel)}</span><strong>WhatsApp ↗</strong></a>` : ''}

  <script src="app.js" defer></script>
  ${tracking ? '<script src="tracking.js" defer></script>' : ''}
  <script src="${attribute(appOrigin)}/sdk/truelead.js" data-project="${attribute(project.publicId)}" data-api="${attribute(appOrigin)}"></script>
</body>
</html>\n`;
}

function buildStyles(config) {
  const c = config.colors;
  return `:root {
  --bg: ${c.background};
  --surface: ${c.surface};
  --accent: ${c.accent};
  --accent-2: ${c.accentSecondary};
  --text: ${c.text};
  --muted: ${c.muted};
  --line: color-mix(in srgb, var(--text) 14%, transparent);
  --soft: color-mix(in srgb, var(--surface) 88%, transparent);
  --shadow: 0 28px 90px color-mix(in srgb, var(--bg) 80%, black 20%);
}

* { box-sizing: border-box; }
html { scroll-behavior: smooth; }
body {
  margin: 0;
  min-height: 100vh;
  color: var(--text);
  background:
    radial-gradient(circle at 15% 8%, color-mix(in srgb, var(--accent) 19%, transparent), transparent 30rem),
    radial-gradient(circle at 88% 20%, color-mix(in srgb, var(--accent-2) 16%, transparent), transparent 32rem),
    var(--bg);
  font-family: Inter, ui-sans-serif, system-ui, -apple-system, BlinkMacSystemFont, "Segoe UI", sans-serif;
  line-height: 1.55;
  overflow-x: hidden;
}
a { color: inherit; }
img { max-width: 100%; display: block; }
.site-header {
  width: min(1160px, calc(100% - 40px));
  margin: 0 auto;
  min-height: 84px;
  display: flex;
  align-items: center;
  justify-content: space-between;
  gap: 24px;
  border-bottom: 1px solid var(--line);
}
.brand { display: inline-flex; align-items: center; gap: 12px; text-decoration: none; font-size: 1.05rem; }
.brand img { width: auto; height: 42px; max-width: 180px; object-fit: contain; }
.brand-mark { width: 38px; height: 38px; display: grid; place-items: center; border-radius: 12px; color: var(--bg); background: linear-gradient(135deg, var(--accent), var(--accent-2)); font-weight: 900; }
.header-cta, .primary-cta, .secondary-cta { display: inline-flex; align-items: center; justify-content: center; gap: 9px; min-height: 48px; padding: 0 20px; border-radius: 14px; font-weight: 800; text-decoration: none; transition: transform .2s ease, filter .2s ease, border-color .2s ease; }
.header-cta, .primary-cta { color: color-mix(in srgb, var(--bg) 86%, black 14%); background: linear-gradient(135deg, var(--accent), var(--accent-2)); box-shadow: 0 16px 45px color-mix(in srgb, var(--accent) 22%, transparent); }
.secondary-cta { border: 1px solid var(--line); background: var(--soft); }
.header-cta:hover, .primary-cta:hover, .secondary-cta:hover { transform: translateY(-2px); filter: brightness(1.07); }
.hero { width: min(1160px, calc(100% - 40px)); min-height: calc(100vh - 84px); margin: 0 auto; padding: 78px 0; display: grid; grid-template-columns: minmax(0, 1.05fr) minmax(360px, .95fr); align-items: center; gap: clamp(45px, 7vw, 90px); }
.layout-centered .hero { grid-template-columns: 1fr; text-align: center; max-width: 920px; }
.layout-centered .hero-copy { max-width: 820px; margin: 0 auto; }
.layout-centered .hero-actions { justify-content: center; }
.layout-centered .hero-visual { max-width: 820px; width: 100%; margin: 0 auto; }
.layout-editorial .hero { grid-template-columns: minmax(0, 1.25fr) minmax(300px, .75fr); }
.eyebrow { display: inline-flex; align-items: center; margin-bottom: 18px; padding: 8px 12px; border: 1px solid color-mix(in srgb, var(--accent) 35%, transparent); border-radius: 999px; color: var(--accent); background: color-mix(in srgb, var(--accent) 9%, transparent); font-size: .78rem; font-weight: 900; letter-spacing: .08em; text-transform: uppercase; }
h1, h2, h3, p { margin-top: 0; }
h1 { max-width: 850px; margin-bottom: 24px; font-size: clamp(3rem, 7vw, 6.7rem); line-height: .94; letter-spacing: -.065em; }
h2 { margin-bottom: 18px; font-size: clamp(2.15rem, 4.5vw, 4.1rem); line-height: 1.02; letter-spacing: -.045em; }
h3 { margin-bottom: 10px; font-size: 1.25rem; }
.hero-description { max-width: 690px; margin-bottom: 30px; color: var(--muted); font-size: clamp(1.05rem, 2vw, 1.28rem); }
.layout-centered .hero-description { margin-left: auto; margin-right: auto; }
.hero-actions { display: flex; flex-wrap: wrap; gap: 12px; }
.microcopy { margin-top: 18px; color: var(--muted); font-size: .88rem; }
.microcopy span { color: var(--accent); }
.hero-visual { position: relative; padding: 12px; border: 1px solid var(--line); border-radius: 30px; background: color-mix(in srgb, var(--surface) 82%, transparent); box-shadow: var(--shadow); }
.hero-visual::before { content: ""; position: absolute; inset: 18% -16% -13% 12%; z-index: -1; border-radius: 50%; background: color-mix(in srgb, var(--accent) 18%, transparent); filter: blur(60px); }
.hero-visual > img { width: 100%; aspect-ratio: 4 / 5; object-fit: cover; border-radius: 21px; }
.layout-centered .hero-visual > img { aspect-ratio: 16 / 8; }
.value-stack { display: grid; gap: 12px; padding: 22px; min-height: 460px; align-content: center; }
.value-stack > div { display: flex; align-items: center; gap: 15px; padding: 20px; border: 1px solid var(--line); border-radius: 18px; background: var(--surface); }
.value-stack span { width: 45px; height: 45px; display: grid; place-items: center; flex: 0 0 auto; border-radius: 13px; color: var(--bg); background: var(--accent); font-size: 1.2rem; }
.section { width: min(1160px, calc(100% - 40px)); margin: 0 auto; padding: 105px 0; }
.section-heading { max-width: 760px; margin-bottom: 45px; }
.section-heading > p, .final-cta p, .feature-card p, .steps p { color: var(--muted); }
.feature-grid { display: grid; grid-template-columns: repeat(3, 1fr); gap: 18px; }
.feature-card { min-height: 245px; padding: 28px; border: 1px solid var(--line); border-radius: 23px; background: linear-gradient(145deg, color-mix(in srgb, var(--surface) 96%, transparent), color-mix(in srgb, var(--accent) 4%, var(--surface))); }
.feature-icon { width: 48px; height: 48px; display: grid; place-items: center; margin-bottom: 48px; border-radius: 14px; color: var(--bg); background: linear-gradient(135deg, var(--accent), var(--accent-2)); font-weight: 900; }
.steps-section { border-top: 1px solid var(--line); }
.steps { display: grid; grid-template-columns: repeat(3, 1fr); gap: 18px; margin: 0; padding: 0; list-style: none; }
.steps li { display: flex; gap: 18px; padding: 25px 0; border-top: 1px solid var(--line); }
.steps li > span { color: var(--accent); font-weight: 900; font-size: 1.2rem; }
.steps strong { display: block; margin-bottom: 6px; font-size: 1.05rem; }
.gallery-section { padding-top: 30px; }
.gallery-grid { display: grid; grid-template-columns: repeat(3, 1fr); gap: 16px; }
.gallery-grid img { width: 100%; aspect-ratio: 4 / 3; object-fit: cover; border: 1px solid var(--line); border-radius: 22px; }
.final-cta { display: flex; align-items: end; justify-content: space-between; gap: 50px; margin-bottom: 60px; padding: clamp(30px, 6vw, 65px); border: 1px solid var(--line); border-radius: 30px; background: linear-gradient(135deg, var(--surface), color-mix(in srgb, var(--accent) 9%, var(--surface))); }
.final-cta > div { max-width: 720px; }
footer { width: min(1160px, calc(100% - 40px)); margin: 0 auto; padding: 30px 0 100px; display: flex; justify-content: space-between; gap: 30px; border-top: 1px solid var(--line); color: var(--muted); font-size: .88rem; }
footer .legal { max-width: 680px; text-align: right; }
.sticky-cta { display: none; }
.reveal { opacity: 0; transform: translateY(20px); transition: opacity .6s ease, transform .6s ease; }
.reveal.is-visible { opacity: 1; transform: none; }
:focus-visible { outline: 3px solid var(--accent); outline-offset: 4px; }

@media (max-width: 900px) {
  .hero, .layout-editorial .hero { min-height: auto; grid-template-columns: 1fr; padding: 65px 0 80px; }
  .hero-copy { text-align: center; }
  .hero-description { margin-left: auto; margin-right: auto; }
  .hero-actions { justify-content: center; }
  .hero-visual { max-width: 660px; width: 100%; margin: 0 auto; }
  .hero-visual > img { aspect-ratio: 16 / 11; }
  .feature-grid, .steps { grid-template-columns: 1fr; }
  .feature-card { min-height: auto; }
  .feature-icon { margin-bottom: 26px; }
  .final-cta { align-items: stretch; flex-direction: column; }
  footer { flex-direction: column; }
  footer .legal { text-align: left; }
}

@media (max-width: 620px) {
  body { padding-bottom: ${config.showStickyCta ? '82px' : '0'}; }
  .site-header, .hero, .section, footer { width: min(100% - 28px, 1160px); }
  .site-header { min-height: 72px; }
  .site-header .header-cta { display: none; }
  h1 { font-size: clamp(2.75rem, 16vw, 4.2rem); }
  .hero-actions { flex-direction: column; }
  .hero-actions a { width: 100%; }
  .section { padding: 80px 0; }
  .gallery-grid { grid-template-columns: 1fr; }
  .sticky-cta { position: fixed; left: 10px; right: 10px; bottom: 10px; z-index: 50; display: flex; align-items: center; justify-content: space-between; gap: 16px; padding: 13px 15px; border: 1px solid var(--line); border-radius: 17px; color: var(--text); background: color-mix(in srgb, var(--surface) 92%, transparent); box-shadow: 0 15px 45px rgba(0,0,0,.35); backdrop-filter: blur(16px); text-decoration: none; }
  .sticky-cta span { overflow: hidden; text-overflow: ellipsis; white-space: nowrap; }
  .sticky-cta strong { color: var(--accent); white-space: nowrap; }
}

@media (prefers-reduced-motion: reduce) {
  *, *::before, *::after { scroll-behavior: auto !important; transition: none !important; animation: none !important; }
  .reveal { opacity: 1; transform: none; }
}\n`;
}

function securityPolicy(appOrigin, tracking) {
  const scriptSources = ["'self'", appOrigin];
  const connectSources = ["'self'", appOrigin];
  const imageSources = ["'self'", 'data:'];
  if (tracking) {
    scriptSources.push('https://connect.facebook.net', 'https://www.googletagmanager.com');
    connectSources.push('https://www.google-analytics.com', 'https://region1.google-analytics.com', 'https://www.facebook.com');
    imageSources.push('https://www.facebook.com', 'https://www.google-analytics.com');
  }
  return `default-src 'self'; script-src ${scriptSources.join(' ')}; connect-src ${connectSources.join(' ')}; img-src ${imageSources.join(' ')}; style-src 'self'; font-src 'self'; object-src 'none'; base-uri 'self'; frame-ancestors 'none'; form-action 'self'; upgrade-insecure-requests`;
}

function netlifyHeaders(appOrigin, tracking) {
  return `/*
  X-Content-Type-Options: nosniff
  X-Frame-Options: DENY
  Referrer-Policy: strict-origin-when-cross-origin
  Permissions-Policy: camera=(), microphone=(), geolocation=()
  Content-Security-Policy: ${securityPolicy(appOrigin, tracking)}
\n`;
}

function vercelConfig(appOrigin, tracking) {
  const headers = [
    { key: 'X-Content-Type-Options', value: 'nosniff' },
    { key: 'X-Frame-Options', value: 'DENY' },
    { key: 'Referrer-Policy', value: 'strict-origin-when-cross-origin' },
    { key: 'Permissions-Policy', value: 'camera=(), microphone=(), geolocation=()' },
    { key: 'Content-Security-Policy', value: securityPolicy(appOrigin, tracking) }
  ];
  return `${JSON.stringify({ headers: [{ source: '/(.*)', headers }] }, null, 2)}\n`;
}

function readme(config, project, appOrigin) {
  return `LANDING GENERADA POR TRUELEAD
================================

Proyecto: ${project.name}
Project Public ID: ${project.publicId}
API/SDK: ${appOrigin}

PUBLICACIÓN
1. Descomprimí este ZIP.
2. Subí todos los archivos a un repositorio de GitHub.
3. Importá el repositorio desde Netlify o Vercel. También funciona en GitHub Pages.
4. Cuando tengas la URL final, agregá su origen exacto en “Dominios autorizados” del proyecto TrueLead.
   Ejemplos: https://mi-marca.vercel.app o https://mi-marca.netlify.app

WHATSAPP Y MEDICIÓN
- No hay un número fijo ni un archivo numeros.json dentro de esta landing.
- El SDK consulta el proyecto ${project.publicId} en TrueLead.
- TrueLead abre el WhatsApp vinculado al proyecto y genera un código TL único.
- El lead real se confirma cuando el mensaje con ese código llega al WhatsApp conectado.
- Si cambiás el WhatsApp vinculado desde TrueLead, no hace falta volver a publicar la landing.

MENSAJE CONFIGURADO
${config.whatsappMessage}

IMPORTANTE
- No borres el atributo data-truelead-whatsapp de los botones.
- Conservá {{code}} en el mensaje para mantener la atribución determinística.
- Verificá textos legales, privacidad, promociones y requisitos regulatorios antes de publicar.
`;
}

function safeArchiveName(value) {
  const normalized = String(value || 'landing')
    .normalize('NFD')
    .replace(/[\u0300-\u036f]/g, '')
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, '-')
    .replace(/^-+|-+$/g, '')
    .slice(0, 60);
  return normalized || 'landing';
}

export function buildLandingPackage({ input = {}, project, appOrigin, rawAssets = {} }) {
  if (!project?.publicId) throw new Error('Proyecto inválido para generar la landing.');
  const normalizedAppOrigin = normalizeOrigin(appOrigin);
  if (!normalizedAppOrigin) throw new Error('APP_URL no está configurada correctamente.');

  const config = normalizeLandingBuilderConfig(input, project);
  const assets = normalizeLandingAssets(rawAssets);
  const tracking = Boolean(config.metaPixelId || config.googleAnalyticsId);
  const files = [
    { name: 'index.html', data: buildLandingHtml({ config, project, assets, appOrigin: normalizedAppOrigin }) },
    { name: 'styles.css', data: buildStyles(config) },
    { name: 'app.js', data: appScript() },
    { name: '_headers', data: netlifyHeaders(normalizedAppOrigin, tracking) },
    { name: 'vercel.json', data: vercelConfig(normalizedAppOrigin, tracking) },
    { name: 'robots.txt', data: 'User-agent: *\nAllow: /\n' },
    { name: 'README-PUBLICAR.txt', data: readme(config, project, normalizedAppOrigin) },
    { name: 'truelead.json', data: `${JSON.stringify({ projectPublicId: project.publicId, api: normalizedAppOrigin, generatedAt: new Date().toISOString() }, null, 2)}\n` }
  ];
  if (tracking) files.push({ name: 'tracking.js', data: trackingScript(config) });
  for (const asset of Object.values(assets)) files.push({ name: asset.filename, data: asset.buffer });

  return {
    config,
    filename: `${safeArchiveName(config.brandName || project.name)}-landing-truelead.zip`,
    files
  };
}

export function appendLandingPackage(archive, landingPackage) {
  for (const file of landingPackage.files) {
    archive.append(file.data, { name: path.posix.normalize(file.name) });
  }
  return archive;
}
