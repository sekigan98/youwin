(function landingBuilderModule() {
  const root = document.querySelector('[data-landing-builder]');
  const form = document.querySelector('[data-landing-builder-form]');
  if (!root || !form) return;

  const projectSelect = form.querySelector('[data-builder-project]');
  const preview = document.querySelector('[data-builder-preview]');
  const previewWrap = document.querySelector('[data-builder-preview-wrap]');
  const saveButton = form.querySelector('[data-builder-save]');
  const downloadButton = form.querySelector('[data-builder-download]');
  const saveState = form.querySelector('[data-builder-save-state]');
  const gate = form.querySelector('[data-builder-gate]');

  const THEME_PALETTES = {
    midnight: { background: '#07101f', surface: '#101c33', accent: '#4de0ae', accentSecondary: '#74a7ff', text: '#f5f8ff', muted: '#aebbd3' },
    ocean: { background: '#061723', surface: '#0e2937', accent: '#37d7ff', accentSecondary: '#4387ff', text: '#f4fbff', muted: '#a9c8d5' },
    ember: { background: '#1b0b0d', surface: '#30151a', accent: '#ffb84d', accentSecondary: '#ff5f6d', text: '#fff8f1', muted: '#d8b9b4' },
    light: { background: '#f4f7fb', surface: '#ffffff', accent: '#1167e8', accentSecondary: '#09a77c', text: '#14213d', muted: '#586780' }
  };

  const ASSET_LIMITS = {
    favicon: { width: 128, height: 128, mime: 'image/png', quality: .92, maxBytes: 512 * 1024 },
    logo: { width: 900, height: 420, mime: 'image/webp', quality: .88, maxBytes: 2 * 1024 * 1024 },
    hero: { width: 1600, height: 1400, mime: 'image/webp', quality: .86, maxBytes: 4 * 1024 * 1024 },
    gallery1: { width: 1200, height: 900, mime: 'image/webp', quality: .84, maxBytes: 2 * 1024 * 1024 },
    gallery2: { width: 1200, height: 900, mime: 'image/webp', quality: .84, maxBytes: 2 * 1024 * 1024 },
    gallery3: { width: 1200, height: 900, mime: 'image/webp', quality: .84, maxBytes: 2 * 1024 * 1024 }
  };

  let projects = [];
  let canBuild = false;
  let selectedProjectId = '';
  let assets = {};
  let previewTimer = null;
  let loadVersion = 0;
  let busy = false;

  function escapeHtml(value = '') {
    return String(value ?? '')
      .replaceAll('&', '&amp;')
      .replaceAll('<', '&lt;')
      .replaceAll('>', '&gt;')
      .replaceAll('"', '&quot;')
      .replaceAll("'", '&#39;');
  }

  function defaultConfig(project = {}) {
    const brand = String(project.name || 'Mi negocio').slice(0, 80);
    return {
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
      colors: { ...THEME_PALETTES.midnight },
      features: [
        { icon: '✓', title: 'Atención directa', copy: 'La consulta llega al WhatsApp correcto, sin pasos innecesarios.' },
        { icon: '⚡', title: 'Respuesta simple', copy: 'El mensaje queda preparado para que la persona solo tenga que enviarlo.' },
        { icon: '↗', title: 'Conversión medible', copy: 'TrueLead registra la intención y confirma el chat cuando realmente llega.' }
      ]
    };
  }

  function setField(name, value) {
    const field = form.elements.namedItem(name);
    if (!field) return;
    if (field.type === 'checkbox') field.checked = Boolean(value);
    else field.value = value ?? '';
  }

  function fieldValue(name) {
    const field = form.elements.namedItem(name);
    if (!field) return '';
    return field.type === 'checkbox' ? field.checked : String(field.value || '').trim();
  }

  function fillForm(config, project) {
    const merged = { ...defaultConfig(project), ...(config || {}) };
    merged.colors = { ...THEME_PALETTES[merged.theme || 'midnight'], ...(config?.colors || {}) };
    merged.features = [0, 1, 2].map((index) => ({
      ...defaultConfig(project).features[index],
      ...(config?.features?.[index] || {})
    }));

    for (const name of [
      'layout', 'theme', 'brandName', 'pageTitle', 'metaDescription', 'badge', 'headline',
      'description', 'ctaLabel', 'whatsappMessage', 'sectionTitle', 'sectionCopy',
      'finalTitle', 'finalCopy', 'footerText', 'legalNotice', 'publishedOrigin',
      'metaPixelId', 'googleAnalyticsId', 'showStickyCta'
    ]) setField(name, merged[name]);
    for (const name of ['background', 'surface', 'accent', 'accentSecondary', 'text', 'muted']) {
      setField(name, merged.colors[name]);
    }
    merged.features.forEach((feature, index) => {
      const number = index + 1;
      setField(`feature${number}Icon`, feature.icon);
      setField(`feature${number}Title`, feature.title);
      setField(`feature${number}Copy`, feature.copy);
    });
  }

  function formConfig() {
    return {
      layout: fieldValue('layout'),
      theme: fieldValue('theme'),
      brandName: fieldValue('brandName'),
      pageTitle: fieldValue('pageTitle'),
      metaDescription: fieldValue('metaDescription'),
      badge: fieldValue('badge'),
      headline: fieldValue('headline'),
      description: fieldValue('description'),
      ctaLabel: fieldValue('ctaLabel'),
      whatsappMessage: fieldValue('whatsappMessage'),
      sectionTitle: fieldValue('sectionTitle'),
      sectionCopy: fieldValue('sectionCopy'),
      finalTitle: fieldValue('finalTitle'),
      finalCopy: fieldValue('finalCopy'),
      footerText: fieldValue('footerText'),
      legalNotice: fieldValue('legalNotice'),
      publishedOrigin: fieldValue('publishedOrigin'),
      metaPixelId: fieldValue('metaPixelId'),
      googleAnalyticsId: fieldValue('googleAnalyticsId'),
      showStickyCta: Boolean(fieldValue('showStickyCta')),
      colors: {
        background: fieldValue('background'),
        surface: fieldValue('surface'),
        accent: fieldValue('accent'),
        accentSecondary: fieldValue('accentSecondary'),
        text: fieldValue('text'),
        muted: fieldValue('muted')
      },
      features: [1, 2, 3].map((number) => ({
        icon: fieldValue(`feature${number}Icon`),
        title: fieldValue(`feature${number}Title`),
        copy: fieldValue(`feature${number}Copy`)
      }))
    };
  }

  function selectedProject() {
    return projects.find((project) => project.id === selectedProjectId) || null;
  }

  function setSaveState(label, type = 'pending') {
    saveState.textContent = label;
    saveState.className = `status ${type}`;
  }

  function setBusy(nextBusy) {
    busy = nextBusy;
    saveButton.disabled = nextBusy || !canBuild || !selectedProjectId;
    downloadButton.disabled = nextBusy || !canBuild || !selectedProjectId;
    projectSelect.disabled = nextBusy || !canBuild;
  }

  function updateProjectFacts() {
    const project = selectedProject();
    document.querySelector('[data-builder-whatsapp]').textContent = project
      ? `${project.whatsappLinkedNumber || 'Sin número'} · ${project.whatsappLinkedStatus || 'desconectado'}`
      : '—';
    document.querySelector('[data-builder-public-id]').textContent = project?.publicId || '—';
    document.querySelector('[data-builder-domains]').textContent = project?.domain
      ? String(project.domain).split(/\s+/).filter(Boolean).join(' · ')
      : 'Pendiente';
  }

  function openAssetDb() {
    return new Promise((resolve, reject) => {
      if (!('indexedDB' in window)) return reject(new Error('IndexedDB no disponible'));
      const request = indexedDB.open('truelead-landing-builder', 1);
      request.onupgradeneeded = () => {
        if (!request.result.objectStoreNames.contains('assets')) request.result.createObjectStore('assets');
      };
      request.onsuccess = () => resolve(request.result);
      request.onerror = () => reject(request.error || new Error('No se pudo abrir el almacenamiento local'));
    });
  }

  async function readStoredAssets(projectId) {
    try {
      const database = await openAssetDb();
      return await new Promise((resolve, reject) => {
        const transaction = database.transaction('assets', 'readonly');
        const request = transaction.objectStore('assets').get(projectId);
        request.onsuccess = () => resolve(request.result || {});
        request.onerror = () => reject(request.error);
        transaction.oncomplete = () => database.close();
      });
    } catch {
      return {};
    }
  }

  async function storeAssets(projectId, nextAssets) {
    try {
      const database = await openAssetDb();
      await new Promise((resolve, reject) => {
        const transaction = database.transaction('assets', 'readwrite');
        transaction.objectStore('assets').put(nextAssets, projectId);
        transaction.oncomplete = resolve;
        transaction.onerror = () => reject(transaction.error);
      });
      database.close();
    } catch {
      // La edición de la sesión sigue funcionando aunque el navegador bloquee IndexedDB.
    }
  }

  function updateAssetStatuses() {
    for (const slot of Object.keys(ASSET_LIMITS)) {
      const status = form.querySelector(`[data-asset-status="${slot}"]`);
      const remove = form.querySelector(`[data-remove-landing-asset="${slot}"]`);
      const card = status?.closest('.upload-card');
      const exists = Boolean(assets[slot]);
      if (status) status.textContent = exists ? 'Imagen lista y optimizada' : (slot === 'logo' ? 'Fondo transparente recomendado' : slot.startsWith('gallery') ? 'Opcional' : 'PNG, JPG o WEBP');
      remove?.classList.toggle('hidden', !exists);
      card?.classList.toggle('has-asset', exists);
    }
  }

  function canvasBlob(canvas, mime, quality) {
    return new Promise((resolve) => canvas.toBlob(resolve, mime, quality));
  }

  function blobDataUrl(blob) {
    return new Promise((resolve, reject) => {
      const reader = new FileReader();
      reader.onload = () => resolve(String(reader.result || ''));
      reader.onerror = () => reject(reader.error || new Error('No se pudo leer la imagen'));
      reader.readAsDataURL(blob);
    });
  }

  async function loadDrawable(file) {
    if ('createImageBitmap' in window) {
      const bitmap = await createImageBitmap(file);
      return { source: bitmap, width: bitmap.width, height: bitmap.height, close: () => bitmap.close?.() };
    }
    const objectUrl = URL.createObjectURL(file);
    try {
      const image = await new Promise((resolve, reject) => {
        const element = new Image();
        element.onload = () => resolve(element);
        element.onerror = () => reject(new Error('El navegador no pudo abrir esta imagen.'));
        element.src = objectUrl;
      });
      return { source: image, width: image.naturalWidth, height: image.naturalHeight, close: () => URL.revokeObjectURL(objectUrl) };
    } catch (error) {
      URL.revokeObjectURL(objectUrl);
      throw error;
    }
  }

  async function optimizeAsset(file, slot) {
    const rule = ASSET_LIMITS[slot];
    if (!rule) throw new Error('Tipo de imagen no permitido.');
    if (slot === 'favicon' && ['image/x-icon', 'image/vnd.microsoft.icon'].includes(file.type)) {
      if (file.size > rule.maxBytes) throw new Error('El favicon supera 512 KB.');
      return blobDataUrl(file);
    }
    if (!/^image\/(png|jpeg|webp)$/i.test(file.type)) throw new Error('Usá una imagen PNG, JPG o WEBP.');
    if (file.size > 12 * 1024 * 1024) throw new Error('La imagen original supera 12 MB.');

    const drawable = await loadDrawable(file);
    const scale = Math.min(1, rule.width / drawable.width, rule.height / drawable.height);
    const width = Math.max(1, Math.round(drawable.width * scale));
    const height = Math.max(1, Math.round(drawable.height * scale));
    const canvas = document.createElement('canvas');
    canvas.width = width;
    canvas.height = height;
    const context = canvas.getContext('2d', { alpha: true });
    context.drawImage(drawable.source, 0, 0, width, height);
    drawable.close();

    let blob = await canvasBlob(canvas, rule.mime, rule.quality);
    if (!blob && rule.mime === 'image/webp') blob = await canvasBlob(canvas, 'image/png', .92);
    if (!blob) throw new Error('El navegador no pudo optimizar esta imagen.');
    if (blob.size > rule.maxBytes) {
      const reduced = await canvasBlob(canvas, rule.mime === 'image/png' ? 'image/webp' : rule.mime, .68);
      if (reduced) blob = reduced;
    }
    if (blob.size > rule.maxBytes) throw new Error('La imagen sigue siendo demasiado pesada después de optimizarla.');
    return blobDataUrl(blob);
  }

  function previewHtml(config) {
    const palette = config.colors;
    const logo = assets.logo;
    const hero = assets.hero;
    const gallery = ['gallery1', 'gallery2', 'gallery3'].filter((slot) => assets[slot]);
    const cards = config.features.map((feature) => `
      <article><i>${escapeHtml(feature.icon)}</i><h3>${escapeHtml(feature.title)}</h3><p>${escapeHtml(feature.copy)}</p></article>`).join('');

    return `<!doctype html><html lang="es"><head><meta charset="utf-8"><meta name="viewport" content="width=device-width,initial-scale=1"><style>
      :root{--bg:${palette.background};--surface:${palette.surface};--accent:${palette.accent};--accent2:${palette.accentSecondary};--text:${palette.text};--muted:${palette.muted}}
      *{box-sizing:border-box}body{margin:0;color:var(--text);background:radial-gradient(circle at 10% 5%,color-mix(in srgb,var(--accent) 18%,transparent),transparent 22rem),var(--bg);font:15px/1.55 Inter,system-ui,sans-serif}header{width:min(100% - 36px,1100px);height:68px;margin:auto;display:flex;align-items:center;justify-content:space-between;border-bottom:1px solid color-mix(in srgb,var(--text) 13%,transparent)}.brand{display:flex;align-items:center;gap:10px;font-weight:900}.brand img{max-width:130px;max-height:34px;object-fit:contain}.mark{width:32px;height:32px;display:grid;place-items:center;border-radius:10px;color:var(--bg);background:var(--accent)}button{border:0;border-radius:11px;padding:11px 15px;color:var(--bg);background:linear-gradient(135deg,var(--accent),var(--accent2));font-weight:900}.hero{width:min(100% - 36px,1100px);min-height:540px;margin:auto;padding:55px 0;display:grid;grid-template-columns:1.05fr .95fr;gap:45px;align-items:center}.layout-centered .hero{grid-template-columns:1fr;text-align:center}.layout-centered .copy{max-width:800px;margin:auto}.layout-centered .visual{max-width:760px;width:100%;margin:auto}.badge{display:inline-block;margin-bottom:16px;padding:6px 10px;border:1px solid color-mix(in srgb,var(--accent) 40%,transparent);border-radius:999px;color:var(--accent);font-size:11px;font-weight:900;text-transform:uppercase}h1{margin:0 0 18px;font-size:clamp(42px,7vw,78px);line-height:.95;letter-spacing:-.055em}p{color:var(--muted)}.copy>p{font-size:17px}.visual{padding:9px;border:1px solid color-mix(in srgb,var(--text) 14%,transparent);border-radius:23px;background:color-mix(in srgb,var(--surface) 88%,transparent)}.visual img{display:block;width:100%;aspect-ratio:4/5;object-fit:cover;border-radius:16px}.placeholder{min-height:390px;display:grid;align-content:center;gap:10px;padding:18px}.placeholder div{padding:17px;border:1px solid color-mix(in srgb,var(--text) 12%,transparent);border-radius:13px;background:var(--surface);font-weight:800}.section{width:min(100% - 36px,1100px);margin:auto;padding:70px 0}.section h2{max-width:720px;margin:0 0 12px;font-size:clamp(30px,5vw,52px);line-height:1}.features{display:grid;grid-template-columns:repeat(3,1fr);gap:12px;margin-top:30px}.features article{padding:22px;border:1px solid color-mix(in srgb,var(--text) 13%,transparent);border-radius:18px;background:var(--surface)}.features i{width:38px;height:38px;display:grid;place-items:center;margin-bottom:28px;border-radius:11px;color:var(--bg);background:var(--accent);font-style:normal;font-weight:900}.features h3{margin:0 0 8px}.features p{margin:0;font-size:13px}.gallery{display:grid;grid-template-columns:repeat(${Math.max(1, gallery.length)},1fr);gap:10px}.gallery img{width:100%;aspect-ratio:4/3;object-fit:cover;border-radius:16px}.final{display:flex;align-items:end;justify-content:space-between;gap:25px;margin-bottom:45px;padding:34px;border-radius:22px;background:var(--surface)}.final h2{margin-bottom:8px}.final p{margin:0}footer{width:min(100% - 36px,1100px);margin:auto;padding:24px 0 60px;border-top:1px solid color-mix(in srgb,var(--text) 13%,transparent);color:var(--muted);font-size:12px}@media(max-width:720px){header button{display:none}.hero{grid-template-columns:1fr;min-height:auto;padding:42px 0}.copy{text-align:center}.visual img{aspect-ratio:16/11}.features{grid-template-columns:1fr}.final{align-items:stretch;flex-direction:column}.final button{width:100%}}
    </style></head><body class="layout-${escapeHtml(config.layout)}"><header><div class="brand">${logo ? `<img src="${logo}" alt="">` : `<span class="mark">${escapeHtml(config.brandName.slice(0, 1).toUpperCase())}</span>`}<span>${escapeHtml(config.brandName)}</span></div><button type="button">${escapeHtml(config.ctaLabel)}</button></header><main><section class="hero"><div class="copy"><span class="badge">${escapeHtml(config.badge)}</span><h1>${escapeHtml(config.headline)}</h1><p>${escapeHtml(config.description)}</p><button type="button">${escapeHtml(config.ctaLabel)} ↗</button></div><div class="visual">${hero ? `<img src="${hero}" alt="">` : `<div class="placeholder">${config.features.map((feature) => `<div>${escapeHtml(feature.icon)} &nbsp; ${escapeHtml(feature.title)}</div>`).join('')}</div>`}</div></section><section class="section"><span class="badge">Por qué elegirnos</span><h2>${escapeHtml(config.sectionTitle)}</h2><p>${escapeHtml(config.sectionCopy)}</p><div class="features">${cards}</div></section>${gallery.length ? `<section class="section"><div class="gallery">${gallery.map((slot) => `<img src="${assets[slot]}" alt="">`).join('')}</div></section>` : ''}<section class="section final"><div><h2>${escapeHtml(config.finalTitle)}</h2><p>${escapeHtml(config.finalCopy)}</p></div><button type="button">${escapeHtml(config.ctaLabel)} ↗</button></section></main><footer>© ${new Date().getFullYear()} ${escapeHtml(config.footerText)}${config.legalNotice ? `<br>${escapeHtml(config.legalNotice)}` : ''}</footer></body></html>`;
  }

  function schedulePreview() {
    clearTimeout(previewTimer);
    previewTimer = setTimeout(() => {
      if (preview) preview.srcdoc = previewHtml(formConfig());
    }, 100);
  }

  async function loadProject(projectId) {
    const version = ++loadVersion;
    selectedProjectId = projectId;
    const project = selectedProject();
    updateProjectFacts();
    fillForm(project?.landingBuilder, project);
    const loadedAssets = project ? await readStoredAssets(project.id) : {};
    if (version !== loadVersion) return;
    assets = loadedAssets;
    updateAssetStatuses();
    setSaveState(project?.landingBuilder ? 'Borrador guardado' : 'Nuevo borrador', project?.landingBuilder ? 'active' : 'pending');
    setBusy(false);
    schedulePreview();
  }

  function refresh(nextProjects = [], capabilities = {}) {
    projects = nextProjects.filter((project) => project.trackingMode !== 'cloud_api');
    canBuild = Boolean(capabilities.canBuildLandings);
    const previous = selectedProjectId;
    projectSelect.replaceChildren();

    if (!projects.length) {
      const option = document.createElement('option');
      option.value = '';
      option.textContent = 'Primero creá un proyecto Landing o Híbrido';
      projectSelect.appendChild(option);
      selectedProjectId = '';
      gate.textContent = canBuild
        ? 'Necesitás crear un proyecto Landing o Híbrido y vincularle un WhatsApp antes de usar el constructor.'
        : 'El constructor está disponible desde Starter.';
      gate.classList.remove('hidden');
      setBusy(false);
      updateProjectFacts();
      schedulePreview();
      return;
    }

    for (const project of projects) {
      const option = document.createElement('option');
      option.value = project.id;
      option.textContent = `${project.name} · ${project.whatsappLinkedNumber || 'sin WhatsApp'}`;
      projectSelect.appendChild(option);
    }
    gate.classList.toggle('hidden', canBuild);
    gate.textContent = canBuild ? '' : 'Tu cuenta Free es solo vista previa. Activá Starter o superior para crear y descargar landings.';
    const nextId = projects.some((project) => project.id === previous) ? previous : projects[0].id;
    projectSelect.value = nextId;
    loadProject(nextId);
  }

  async function saveDraft({ silent = false } = {}) {
    if (busy || !selectedProjectId || !canBuild) return null;
    if (!form.reportValidity()) return null;
    setBusy(true);
    setSaveState('Guardando…', 'pending');
    try {
      const data = await TrueLeadAPI.put(`/api/agency/landing-builder/projects/${encodeURIComponent(selectedProjectId)}`, {
        config: formConfig()
      });
      const index = projects.findIndex((project) => project.id === selectedProjectId);
      if (index !== -1) projects[index] = { ...projects[index], ...data.project };
      setSaveState('Borrador guardado', 'active');
      updateProjectFacts();
      window.dispatchEvent(new CustomEvent('truelead:project-updated', { detail: data.project }));
      if (!silent) TLUtils.showMessage(messageBox, 'Borrador de landing guardado.', 'success');
      return data;
    } catch (error) {
      setSaveState('Error al guardar', 'error');
      TLUtils.showMessage(messageBox, error.message, 'error');
      return null;
    } finally {
      setBusy(false);
    }
  }

  async function downloadLanding() {
    if (busy || !selectedProjectId || !canBuild) return;
    const saved = await saveDraft({ silent: true });
    if (!saved) return;
    setBusy(true);
    const originalLabel = downloadButton.textContent;
    downloadButton.textContent = 'Generando ZIP…';
    setSaveState('Empaquetando…', 'pending');
    try {
      const { response, blob } = await TrueLeadAPI.requestBlob(
        `/api/agency/landing-builder/projects/${encodeURIComponent(selectedProjectId)}/export`,
        { method: 'POST', body: { config: formConfig(), assets } }
      );
      const disposition = response.headers.get('Content-Disposition') || '';
      const filename = disposition.match(/filename="?([^";]+)"?/i)?.[1] || 'landing-truelead.zip';
      const url = URL.createObjectURL(blob);
      const link = document.createElement('a');
      link.href = url;
      link.download = filename;
      document.body.appendChild(link);
      link.click();
      link.remove();
      setTimeout(() => URL.revokeObjectURL(url), 1000);
      setSaveState('ZIP descargado', 'active');
      TLUtils.showMessage(messageBox, 'Landing lista. Descomprimí el ZIP y subí todos los archivos a GitHub, Netlify o Vercel.', 'success');
    } catch (error) {
      setSaveState('Error al descargar', 'error');
      TLUtils.showMessage(messageBox, error.message, 'error');
    } finally {
      downloadButton.textContent = originalLabel;
      setBusy(false);
    }
  }

  projectSelect.addEventListener('change', () => loadProject(projectSelect.value));
  form.addEventListener('input', (event) => {
    if (event.target.matches('[type="file"]')) return;
    setSaveState('Cambios sin guardar', 'pending');
    schedulePreview();
  });
  form.querySelector('[data-builder-theme]')?.addEventListener('change', (event) => {
    const palette = THEME_PALETTES[event.target.value] || THEME_PALETTES.midnight;
    for (const [name, value] of Object.entries(palette)) setField(name, value);
    schedulePreview();
  });

  form.querySelectorAll('[data-landing-asset]').forEach((input) => {
    input.addEventListener('change', async () => {
      const slot = input.dataset.landingAsset;
      const file = input.files?.[0];
      if (!file || !selectedProjectId) return;
      const status = form.querySelector(`[data-asset-status="${slot}"]`);
      if (status) status.textContent = 'Optimizando…';
      try {
        assets[slot] = await optimizeAsset(file, slot);
        await storeAssets(selectedProjectId, assets);
        updateAssetStatuses();
        setSaveState('Imagen guardada localmente', 'pending');
        schedulePreview();
      } catch (error) {
        input.value = '';
        updateAssetStatuses();
        TLUtils.showMessage(messageBox, error.message, 'error');
      }
    });
  });

  form.querySelectorAll('[data-remove-landing-asset]').forEach((button) => {
    button.addEventListener('click', async (event) => {
      event.preventDefault();
      const slot = button.dataset.removeLandingAsset;
      delete assets[slot];
      const input = form.querySelector(`[data-landing-asset="${slot}"]`);
      if (input) input.value = '';
      await storeAssets(selectedProjectId, assets);
      updateAssetStatuses();
      setSaveState('Imagen quitada', 'pending');
      schedulePreview();
    });
  });

  saveButton.addEventListener('click', () => saveDraft());
  downloadButton.addEventListener('click', downloadLanding);
  document.querySelectorAll('[data-preview-size]').forEach((button) => {
    button.addEventListener('click', () => {
      document.querySelectorAll('[data-preview-size]').forEach((item) => item.classList.toggle('active', item === button));
      previewWrap.classList.toggle('mobile', button.dataset.previewSize === 'mobile');
    });
  });

  window.TrueLeadLandingBuilder = { refresh, schedulePreview };
  fillForm(defaultConfig(), {});
  schedulePreview();
})();
