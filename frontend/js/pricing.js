
(async function () {
  const cards = document.querySelectorAll('[data-price-plan]');
  if (!cards.length) return;

  function escapeHtml(value) {
    return String(value ?? '').replace(/[&<>'"]/g, (char) => ({
      '&': '&amp;', '<': '&lt;', '>': '&gt;', "'": '&#39;', '"': '&quot;'
    })[char]);
  }

  function guessCountry() {
    try {
      const tz = Intl.DateTimeFormat().resolvedOptions().timeZone || '';
      if (tz.toLowerCase().includes('argentina') || tz === 'America/Buenos_Aires') return 'AR';
    } catch {}
    const lang = navigator.language || '';
    return lang.toLowerCase() === 'es-ar' ? 'AR' : 'INTL';
  }

  function renderPlan(card, plan) {
    const suffix = plan.displaySuffix ? `<span>${escapeHtml(plan.displaySuffix)}</span>` : '';
    card.querySelector('[data-plan-name]').textContent = plan.name;
    card.querySelector('[data-plan-title]').textContent = plan.title;
    card.querySelector('[data-plan-price]').innerHTML = `${escapeHtml(plan.displayPrice)}${suffix}`;
    const ul = card.querySelector('[data-plan-features]');
    ul.innerHTML = plan.features.map(feature => `<li>${escapeHtml(feature)}</li>`).join('');
  }

  try {
    const country = guessCountry();
    const tz = Intl.DateTimeFormat().resolvedOptions().timeZone || '';
    const pricing = await TrueLeadAPI.get(`/api/public/pricing?country=${encodeURIComponent(country)}&tz=${encodeURIComponent(tz)}`);

    cards.forEach(card => {
      const plan = pricing.plans.find(item => item.id === card.dataset.pricePlan);
      if (plan) renderPlan(card, plan);
    });

    const note = document.querySelector('[data-pricing-note]');
    if (note) {
      note.textContent = pricing.currency === 'ARS'
        ? `Precios en pesos argentinos. Tipo de cambio configurado en Render: $${Number(pricing.usdArsRate).toLocaleString('es-AR')} ARS por USD.`
        : 'Precios en dólares estadounidenses. Si ingresás desde Argentina, TrueLead muestra valores en pesos argentinos.';
    }
  } catch (error) {
    console.warn('No se pudo cargar pricing dinámico:', error);
  }
})();
