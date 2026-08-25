
(function () {
  const currentScript = document.currentScript;
  const projectPublicId = currentScript?.dataset.project || '';
  const scriptOrigin = currentScript?.src ? new URL(currentScript.src, location.href).origin : location.origin;
  const apiBase = String(currentScript?.dataset.api || scriptOrigin).replace(/\/$/, '');
  const defaultMessage = currentScript?.dataset.message || '';
  let memoryVisitorId = '';

  function createVisitorId() {
    return 'v_' + (globalThis.crypto?.randomUUID?.().replaceAll('-', '') ||
      (Math.random().toString(36).slice(2) + Date.now().toString(36)));
  }

  function getCookie(name) {
    return document.cookie
      .split('; ')
      .find(row => row.startsWith(name + '='))
      ?.split('=')[1] || '';
  }

  function getVisitorId() {
    const key = 'truelead_visitor_id';
    try {
      let value = localStorage.getItem(key);
      if (!value) {
        value = createVisitorId();
        localStorage.setItem(key, value);
      }
      return value;
    } catch {
      memoryVisitorId ||= createVisitorId();
      return memoryVisitorId;
    }
  }

  function collectUtm() {
    const params = new URLSearchParams(location.search);
    const keys = ['utm_source', 'utm_medium', 'utm_campaign', 'utm_content', 'utm_term', 'ad_id', 'adset_id', 'campaign_id'];
    const out = {};
    keys.forEach(key => {
      if (params.get(key)) out[key] = params.get(key);
    });
    return out;
  }

  function getFbc() {
    const cookieValue = getCookie('_fbc');
    if (cookieValue) return cookieValue;
    const fbclid = new URLSearchParams(location.search).get('fbclid');
    return fbclid ? `fb.1.${Date.now()}.${fbclid}` : '';
  }

  async function createPrelead(button) {
    const messageTemplate = button?.dataset.trueleadMessage || defaultMessage || '';
    const buttonSource = button?.dataset.trueleadSource || button?.id || button?.textContent?.trim() || '';

    const response = await fetch(apiBase + '/api/preleads', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({
        projectPublicId,
        landingUrl: location.origin + location.pathname,
        landingOrigin: location.origin,
        visitorId: getVisitorId(),
        buttonSource,
        messageTemplate,
        fbp: getCookie('_fbp'),
        fbc: getFbc(),
        utm: collectUtm()
      })
    });
    const data = await response.json().catch(() => ({}));
    if (!response.ok) {
      const details = data.origin ? ` (${data.origin})` : '';
      throw new Error((data.error || 'No se pudo crear el lead.') + details);
    }
    return data;
  }

  if (!projectPublicId) {
    console.warn('[TrueLead] Falta data-project en el script.');
    return;
  }

  function bindButton(button) {
    if (button.dataset.trueleadBound === projectPublicId) return;
    button.dataset.trueleadBound = projectPublicId;
    button.addEventListener('click', async (event) => {
      event.preventDefault();

      const originalText = button.textContent;
      button.textContent = button.dataset.trueleadLoading || 'Abriendo WhatsApp...';
      button.setAttribute('aria-busy', 'true');

      try {
        const prelead = await createPrelead(button);
        if (prelead.whatsappHref) {
          window.location.href = prelead.whatsappHref;
        } else {
          throw new Error('El proyecto no tiene WhatsApp vinculado.');
        }
      } catch (error) {
        console.error('[TrueLead]', error);
        alert(error.message);
        button.textContent = originalText;
        button.removeAttribute('aria-busy');
      }
    });
  }

  function bindButtons(root = document) {
    if (root.matches?.('[data-truelead-whatsapp]')) bindButton(root);
    root.querySelectorAll?.('[data-truelead-whatsapp]').forEach(bindButton);
  }

  if (document.readyState === 'loading') {
    document.addEventListener('DOMContentLoaded', () => bindButtons(), { once: true });
  } else {
    bindButtons();
  }

  const observer = new MutationObserver((mutations) => {
    for (const mutation of mutations) {
      for (const node of mutation.addedNodes) {
        if (node.nodeType === Node.ELEMENT_NODE) bindButtons(node);
      }
    }
  });
  observer.observe(document.documentElement, { childList: true, subtree: true });
})();
