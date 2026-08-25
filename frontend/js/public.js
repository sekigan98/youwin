document.querySelectorAll('[data-year]').forEach(el => el.textContent = new Date().getFullYear());

function runWhenReady(fn) {
  if (document.readyState === 'loading') {
    document.addEventListener('DOMContentLoaded', fn, { once: true });
  } else {
    fn();
  }
}

function makeLink(className, href, text) {
  const link = document.createElement('a');
  link.className = className;
  link.href = href;
  link.textContent = text;
  return link;
}

function makeChip(text) {
  const chip = document.createElement('span');
  chip.className = 'session-chip';
  chip.dataset.sessionChip = 'true';
  chip.textContent = text;
  return chip;
}

function normalizeMarketingAuthLinks() {
  if (!TrueLeadAPI.isMarketingHost?.()) return;

  document.querySelectorAll('a[href="/login"], a[href="login"], a[href="login.html"]').forEach((link) => {
    link.href = TrueLeadAPI.pageUrl('login');
  });

  document.querySelectorAll('a[href="/register"], a[href="register"], a[href="register.html"]').forEach((link) => {
    link.href = TrueLeadAPI.pageUrl('register');
  });

  document.querySelectorAll('a[href="/admin-login"], a[href="admin-login"], a[href="admin-login.html"]').forEach((link) => {
    link.href = TrueLeadAPI.pageUrl('admin-login');
  });
}

function hydrateSessionLinks() {
  normalizeMarketingAuthLinks();
  const localUser = TrueLeadAPI.user();
  const hint = TrueLeadAPI.sessionHint?.() || {};
  const isLogged = Boolean(localUser || hint.loggedIn);
  if (!isLogged) return;

  const role = localUser?.role || hint.role || 'agency';
  const userName = localUser?.name || hint.name || 'Sesión activa';
  const agencyPlan = localUser?.agency?.plan || hint.plan || '';
  const panelHref = TrueLeadAPI.panelUrl(role);
  const logoutHref = TrueLeadAPI.logoutUrl();
  const panelText = role === 'admin' ? 'Ver admin' : 'Ver panel';
  const chipText = agencyPlan ? `${userName} · ${agencyPlan}` : userName;

  document.querySelectorAll('a[href="/login"], a[href="login"], a[href="login.html"], a[href="/panel"], a[href="panel"], a[href="app.html"], a[href="/admin"], a[href="admin"], a[href="admin.html"]').forEach((link) => {
    link.href = panelHref;
    link.textContent = panelText;
  });

  document.querySelectorAll('a[href="/register"], a[href="register"], a[href="register.html"]').forEach((link) => {
    link.href = panelHref;
    if (/crear|empezar|escalar|contactar/i.test(link.textContent || '')) {
      link.textContent = panelText;
    }
  });

  const actions = document.querySelector('.header .actions');
  if (actions) {
    actions.replaceChildren(
      makeChip(chipText),
      makeLink('btn btn-primary', panelHref, panelText),
      makeLink('btn btn-secondary', logoutHref, 'Cerrar sesión')
    );
  }

  const heroActions = document.querySelector('.hero-actions');
  if (heroActions) {
    heroActions.replaceChildren(
      makeLink('btn btn-primary', panelHref, panelText),
      makeLink('btn btn-secondary', logoutHref, 'Cerrar sesión')
    );
  }
}

runWhenReady(hydrateSessionLinks);

const demoButtons = document.querySelectorAll('[data-demo-register]');
demoButtons.forEach(btn => btn.addEventListener('click', () => {
  location.href = TrueLeadAPI.panelUrl('agency');
}));
