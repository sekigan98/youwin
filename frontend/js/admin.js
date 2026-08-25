
const user = TrueLeadAPI.user();
const messageBox = document.querySelector('[data-message]');

if (!user) location.href = '/admin-login';
if (user?.role !== 'admin') location.href = '/panel';

document.querySelector('[data-admin-name]').textContent = user.name || 'Admin';
document.querySelector('[data-logout]')?.addEventListener('click', async () => {
  await TrueLeadAPI.logout();
  location.href = '/admin-login';
});

let adminState = { overview: null, agencies: [], pricing: null };

function escapeHtml(value = '') {
  return String(value ?? '')
    .replaceAll('&', '&amp;')
    .replaceAll('<', '&lt;')
    .replaceAll('>', '&gt;')
    .replaceAll('"', '&quot;')
    .replaceAll("'", '&#039;');
}

function setAdminTab(tab) {
  document.querySelectorAll('[data-admin-tab]').forEach(btn => btn.classList.toggle('active', btn.dataset.adminTab === tab));
  document.querySelectorAll('[data-admin-panel]').forEach(panel => panel.classList.toggle('hidden', panel.dataset.adminPanel !== tab));
}
document.querySelectorAll('[data-admin-tab]').forEach(btn => btn.addEventListener('click', () => setAdminTab(btn.dataset.adminTab)));

function renderOverview() {
  const m = adminState.overview?.metrics || {};
  for (const [key, value] of Object.entries(m)) {
    const el = document.querySelector(`[data-admin-metric="${key}"]`);
    if (el) el.textContent = value ?? 0;
  }

  const events = adminState.overview?.recentEvents || [];
  document.querySelector('[data-admin-events]').innerHTML = events.length
    ? events.map(ev => `
      <article class="soft client-card">
        <strong>${escapeHtml(ev.type)}</strong>
        <p>${escapeHtml(ev.message)}</p>
        <small>${TLUtils.formatDate(ev.createdAt)}</small>
      </article>
    `).join('')
    : '<p class="muted">Todavía no hay actividad.</p>';
}

function renderAgencies() {
  const body = document.querySelector('[data-agencies-table]');
  body.innerHTML = adminState.agencies.length ? adminState.agencies.map(a => `
    <tr>
      <td>
        <strong>${escapeHtml(a.name)}</strong><br>
        <small>${escapeHtml((a.users || []).map(u => u.email).join(', ') || '-')}</small>
      </td>
      <td><span class="tag ${TLUtils.statusClass(a.status)}">${escapeHtml(a.status)}</span></td>
      <td>${escapeHtml(a.plan || '-')}</td>
      <td>${(a.users || []).length}</td>
      <td>${a.projectsCount || 0}</td>
      <td>
        <strong>${a.leadsCount || 0}</strong><br>
        <small>${a.messagesCount || 0} mensajes · ${a.purchasesCount || 0} comprob.</small>
      </td>
      <td>${TLUtils.formatDate(a.expiresAt)}</td>
      <td>
        <div class="actions">
          <button class="btn btn-primary btn-small" data-activate="${escapeHtml(a.id)}">Activar</button>
          <button class="btn btn-secondary btn-small" data-change-plan="${escapeHtml(a.id)}">Plan</button>
          <button class="btn btn-secondary btn-small" data-payment="${escapeHtml(a.id)}">Pago</button>
          <button class="btn btn-danger btn-small" data-suspend="${escapeHtml(a.id)}">Suspender</button>
          <button class="btn btn-danger btn-small" data-clear-history="${escapeHtml(a.id)}">Borrar historial</button>
        </div>
      </td>
    </tr>
  `).join('') : '<tr><td colspan="8">No hay agencias.</td></tr>';

  body.querySelectorAll('[data-activate]').forEach(btn => btn.addEventListener('click', () => updateAgencyStatus(btn.dataset.activate, 'active')));
  body.querySelectorAll('[data-suspend]').forEach(btn => btn.addEventListener('click', () => updateAgencyStatus(btn.dataset.suspend, 'suspended')));
  body.querySelectorAll('[data-payment]').forEach(btn => btn.addEventListener('click', () => createPayment(btn.dataset.payment)));
  body.querySelectorAll('[data-change-plan]').forEach(btn => btn.addEventListener('click', () => changePlan(btn.dataset.changePlan)));
  body.querySelectorAll('[data-clear-history]').forEach(btn => btn.addEventListener('click', () => clearAgencyHistory(btn.dataset.clearHistory)));
}

function allPayments() {
  return adminState.agencies.flatMap(a => (a.payments || []).map(p => ({ ...p, agencyName: a.name })));
}

function renderPayments() {
  const payments = allPayments().sort((a, b) => String(b.createdAt).localeCompare(String(a.createdAt)));
  const body = document.querySelector('[data-payments-table]');
  body.innerHTML = payments.length ? payments.map(p => `
    <tr>
      <td>${escapeHtml(p.agencyName)}</td>
      <td>${escapeHtml(p.plan || '-')}</td>
      <td>${escapeHtml(p.currency || 'ARS')} ${Number(p.amount || 0).toLocaleString('es-AR')}</td>
      <td><span class="tag ${TLUtils.statusClass(p.status)}">${escapeHtml(p.status)}</span></td>
      <td>${escapeHtml(p.method || 'manual')}</td>
      <td>${TLUtils.formatDate(p.createdAt)}</td>
      <td>
        <div class="actions">
          <button class="btn btn-primary btn-small" data-approve-payment="${escapeHtml(p.id)}">Aprobar</button>
          <button class="btn btn-danger btn-small" data-reject-payment="${escapeHtml(p.id)}">Rechazar</button>
        </div>
      </td>
    </tr>
  `).join('') : '<tr><td colspan="7">No hay pagos.</td></tr>';

  body.querySelectorAll('[data-approve-payment]').forEach(btn => btn.addEventListener('click', () => validatePayment(btn.dataset.approvePayment, 'approved')));
  body.querySelectorAll('[data-reject-payment]').forEach(btn => btn.addEventListener('click', () => validatePayment(btn.dataset.rejectPayment, 'rejected')));
}

function renderPricing() {
  const pricing = adminState.pricing;
  const grid = document.querySelector('[data-admin-pricing-grid]');
  const rateNote = document.querySelector('[data-rate-note]');
  if (!pricing || !grid) return;

  rateNote.textContent = `Tipo de cambio activo en Render: 1 USD = $${Number(pricing.usdArsRate).toLocaleString('es-AR')} ARS. Para cambiarlo, editá TRUELEAD_USD_ARS_RATE en Environment de Render y redeploy.`;

  grid.innerHTML = pricing.plans.map(plan => `
    <article class="card price-card ${plan.featured ? 'featured' : ''}">
      <span class="pill">${escapeHtml(plan.name)}</span>
      <h3>${escapeHtml(plan.title)}</h3>
      <strong class="price">${escapeHtml(plan.displayPrice)}${plan.displaySuffix ? `<span>${escapeHtml(plan.displaySuffix)}</span>` : ''}</strong>
      <p class="muted">USD base: ${plan.usdMonthly == null ? 'Consultar' : `USD ${plan.usdMonthly}`}</p>
      <p class="muted">ARS calculado: ${plan.arsMonthly == null ? 'Consultar' : `$${Number(plan.arsMonthly).toLocaleString('es-AR')}`}</p>
      <ul>${plan.features.map(f => `<li>${escapeHtml(f)}</li>`).join('')}</ul>
    </article>
  `).join('');
}

async function loadAdmin() {
  try {
    const [overview, agencies, pricing] = await Promise.all([
      TrueLeadAPI.get('/api/admin/overview'),
      TrueLeadAPI.get('/api/admin/agencies'),
      TrueLeadAPI.get('/api/admin/pricing?country=AR')
    ]);
    adminState.overview = overview;
    adminState.agencies = agencies.agencies || [];
    adminState.pricing = pricing;
    renderOverview();
    renderAgencies();
    renderPayments();
    renderPricing();
  } catch (error) {
    TLUtils.showMessage(messageBox, error.message, 'error');
  }
}

async function updateAgencyStatus(id, status) {
  try {
    await TrueLeadAPI.patch(`/api/admin/agencies/${id}/status`, { status });
    TLUtils.showMessage(messageBox, `Agencia actualizada: ${status}`, 'success');
    await loadAdmin();
  } catch (error) {
    TLUtils.showMessage(messageBox, error.message, 'error');
  }
}

async function changePlan(agencyId) {
  const agency = adminState.agencies.find(a => a.id === agencyId);
  const planOptions = (adminState.pricing?.plans || []).map(p => p.id).join(', ');
  const plan = prompt(`Nuevo plan (${planOptions}):`, agency?.plan || 'pro');
  if (!plan) return;
  const expiresAt = prompt('Vencimiento ISO o fecha YYYY-MM-DD:', agency?.expiresAt || new Date(Date.now() + 30 * 86400000).toISOString());
  try {
    await TrueLeadAPI.patch(`/api/admin/agencies/${agencyId}/plan`, {
      plan,
      expiresAt,
      planStatus: 'active',
      activate: true
    });
    TLUtils.showMessage(messageBox, `Plan actualizado a ${plan}.`, 'success');
    await loadAdmin();
  } catch (error) {
    TLUtils.showMessage(messageBox, error.message, 'error');
  }
}


async function clearAgencyHistory(agencyId) {
  const agency = adminState.agencies.find(a => a.id === agencyId);
  if (!agency) return;

  const warning = `Vas a borrar historial de ${agency.name}: ${agency.leadsCount || 0} leads, ${agency.messagesCount || 0} mensajes y ${agency.purchasesCount || 0} comprobantes.\n\nNo elimina clientes, proyectos, usuarios, pagos ni WhatsApps vinculados.`;
  if (!confirm(warning)) return;

  const confirmation = prompt('Para confirmar escribí BORRAR:', '');
  if (confirmation !== 'BORRAR') return;

  try {
    const result = await TrueLeadAPI.delete(`/api/admin/agencies/${agencyId}/history`);
    const removed = result.removed || {};
    TLUtils.showMessage(messageBox, `Historial eliminado. Leads: ${removed.preleads || 0}, mensajes: ${removed.whatsappMessages || 0}, comprobantes: ${removed.purchases || 0}.`, 'success');
    await loadAdmin();
  } catch (error) {
    TLUtils.showMessage(messageBox, error.message, 'error');
  }
}

async function createPayment(agencyId) {
  const amount = prompt('Monto del pago:', '49000');
  if (amount === null) return;
  const plan = prompt('Plan:', 'pro') || 'pro';
  try {
    await TrueLeadAPI.post(`/api/admin/agencies/${agencyId}/payments`, {
      amount: Number(amount || 0),
      currency: 'ARS',
      plan,
      status: 'pending',
      method: 'manual',
      notes: 'Pago cargado desde backoffice.'
    });
    TLUtils.showMessage(messageBox, 'Pago cargado correctamente.', 'success');
    await loadAdmin();
  } catch (error) {
    TLUtils.showMessage(messageBox, error.message, 'error');
  }
}

async function validatePayment(paymentId, status) {
  try {
    await TrueLeadAPI.patch(`/api/admin/payments/${paymentId}/validate`, { status });
    TLUtils.showMessage(messageBox, `Pago ${status}.`, 'success');
    await loadAdmin();
  } catch (error) {
    TLUtils.showMessage(messageBox, error.message, 'error');
  }
}

document.querySelectorAll('[data-reload-admin]').forEach(btn => btn.addEventListener('click', loadAdmin));

loadAdmin();
