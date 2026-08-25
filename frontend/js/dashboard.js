const user = TrueLeadAPI.user();
const messageBox = document.querySelector('[data-message]');

if (!user) location.href = '/login';
if (user?.role === 'admin') document.querySelector('[data-admin-link]')?.classList.remove('hidden');

document.querySelector('[data-user-initials]').textContent = (user?.name || 'TL').split(' ').map(x => x[0]).slice(0,2).join('').toUpperCase();
document.querySelector('[data-logout]')?.addEventListener('click', async () => {
  await TrueLeadAPI.logout();
  location.href = '/login';
});

let state = {
  dashboard: null,
  clients: [],
  projects: [],
  leads: [],
  conversionJobs: [],
  purchases: [],
  whatsapp: null,
  whatsappSessions: [],
  range: {
    range: 'month',
    from: '',
    to: ''
  }
};

function setTab(tab) {
  document.querySelectorAll('[data-tab]').forEach(btn => btn.classList.toggle('active', btn.dataset.tab === tab));
  document.querySelectorAll('[data-panel]').forEach(panel => panel.classList.toggle('hidden', panel.dataset.panel !== tab));
  const title = {
    overview: 'Resumen',
    clients: 'Clientes',
    projects: 'Proyectos',
    'landing-builder': 'Crear landing',
    leads: 'Leads reales',
    meta: 'Meta CAPI',
    purchases: 'Comprobantes',
    whatsapp: 'WhatsApp',
    billing: 'Mi plan'
  }[tab] || 'Resumen';
  document.querySelector('[data-title]').textContent = title;
}
document.querySelectorAll('[data-tab]').forEach(btn => btn.addEventListener('click', () => setTab(btn.dataset.tab)));
document.querySelectorAll('[data-tab-shortcut]').forEach(btn => btn.addEventListener('click', () => setTab(btn.dataset.tabShortcut)));

function rangeQuery() {
  const params = new URLSearchParams();
  params.set('range', state.range.range || 'month');
  params.set('tzOffsetMinutes', String(new Date().getTimezoneOffset()));
  if (state.range.range === 'custom') {
    if (state.range.from) params.set('from', state.range.from);
    if (state.range.to) params.set('to', state.range.to);
  }
  return params.toString();
}

function clientName(id) {
  return state.clients.find(c => c.id === id)?.name || 'Sin cliente';
}

function projectCurrency(projectId) {
  return state.projects.find(project => project.id === projectId)?.metaCurrency || 'ARS';
}

function sessionLabel(session) {
  if (!session) return 'Sin WhatsApp';
  const name = session.label || 'WhatsApp';
  const client = session.client || clientName(session.clientId);
  const number = session.number ? ` · ${session.number}` : '';
  return `${client} · ${name}${number}`;
}

function leadPhone(lead) {
  return lead.manualPhone || lead.phoneDisplay || lead.whatsappFromPhone || lead.phone || (lead.whatsappFromLast4 ? `••••${lead.whatsappFromLast4}` : '');
}

function leadPhoneCell(lead) {
  const phone = leadPhone(lead);
  const canEdit = Boolean(planCapabilities().canEditLeadPhones);
  const label = phone ? 'Editar' : 'Agregar';
  const phoneText = phone ? escapeHtml(phone) : '<span class="muted">Sin teléfono</span>';
  return `
    <div class="phone-cell">
      <strong>${phoneText}</strong>
      ${canEdit ? `<button type="button" class="mini-link" data-edit-lead-phone="${escapeHtml(lead.id)}">${label}</button>` : '<small class="muted">Disponible desde Starter</small>'}
    </div>
  `;
}

function planCapabilities() {
  return state.dashboard?.capabilities || state.dashboard?.plan?.capabilities || {};
}

function canExportLeads() {
  return Boolean(planCapabilities().canExportLeads);
}

function isFreePlan() {
  const agency = state.dashboard?.agency || user.agency || {};
  return String(agency.plan || state.dashboard?.plan?.id || '').toLowerCase() === 'free' || planCapabilities().upgradeRequired;
}

function paidPlanRequiredMessage(action = 'usar esta función') {
  const agency = state.dashboard?.agency || user.agency || {};
  if (agency.status === 'expired' || agency.planStatus === 'expired') {
    return `Tu plan venció. Reactivalo para ${action}.`;
  }
  return `Tu cuenta Free es solo vista previa. Para ${action}, necesitás activar Starter o superior.`;
}

function renderExportGate() {
  const canExport = canExportLeads();
  document.querySelectorAll('[data-export-format]').forEach((button) => {
    button.disabled = !canExport;
    button.classList.toggle('is-disabled', !canExport);
    button.title = canExport ? '' : 'Disponible desde Starter';
  });

  const note = document.querySelector('[data-export-note]');
  if (note) {
    note.textContent = canExport
      ? 'Exportación incluida. Si WhatsApp entrega LID, usá Agregar/Editar para cargar el teléfono real antes de descargar la base.'
      : 'Tu cuenta Free es solo vista previa. Activá Starter o superior para exportar CSV/XLSX.';
    note.classList.toggle('success', canExport);
  }
}

function exportFileNameFromResponse(response, fallback) {
  const disposition = response.headers.get('Content-Disposition') || '';
  const match = disposition.match(/filename="?([^";]+)"?/i);
  return match?.[1] || fallback;
}


function escapeHtml(value = '') {
  return String(value ?? '')
    .replaceAll('&', '&amp;')
    .replaceAll('<', '&lt;')
    .replaceAll('>', '&gt;')
    .replaceAll('"', '&quot;')
    .replaceAll("'", '&#039;');
}

function setField(form, name, value = '') {
  const field = form?.elements?.[name];
  if (field) field.value = value ?? '';
}

function closeModal(modal) {
  modal?.classList.remove('open');
}

function modalByName(name) {
  return document.querySelector(`[data-modal="${name}"]`);
}

function renderMetrics() {
  const metrics = state.dashboard?.metrics || {};
  const set = (name, value) => {
    const el = document.querySelector(`[data-metric="${name}"]`);
    if (el) el.textContent = value;
  };
  set('clients', metrics.clients ?? 0);
  set('projects', metrics.projects ?? 0);
  set('clicks', metrics.clicks ?? 0);
  set('confirmed', metrics.confirmed ?? 0);
  set('totalIncomingMessages', metrics.totalIncomingMessages ?? 0);
  set('paymentProofs', metrics.paymentProofs ?? 0);
  set('salesConversionRate', `${metrics.salesConversionRate ?? 0}%`);
  set('metaSent', metrics.metaSent ?? metrics.sentToMeta ?? 0);

  const conv = document.querySelector('[data-metric="conversionRate"]');
  if (conv) conv.textContent = `${metrics.leadConversionRate ?? metrics.conversionRate ?? 0}% landing · ${metrics.directConfirmed ?? 0} directos`;
  const confirmedPurchasesEl = document.querySelector('[data-metric="purchasesConfirmed"]');
  if (confirmedPurchasesEl) confirmedPurchasesEl.textContent = `${metrics.purchasesConfirmed ?? 0} compras validadas`;
  const queueSummary = document.querySelector('[data-metric="metaQueueSummary"]');
  if (queueSummary) queueSummary.textContent = `${metrics.metaQueued ?? 0} en cola · ${metrics.metaFailed ?? 0} con error`;

  const agency = state.dashboard?.agency || user.agency || {};
  const plan = state.dashboard?.plan || {};
  const capabilities = planCapabilities();
  document.querySelector('[data-agency-plan]').textContent = `${plan.name || agency.plan || 'starter'} · ${agency.planStatus || agency.status || 'pendiente'}`;
  document.querySelector('[data-agency-status]').textContent = `Estado: ${agency.status || 'pendiente'}`;

  const phonePolicy = document.querySelector('[data-phone-policy]');
  if (phonePolicy) {
    phonePolicy.textContent = agency.status === 'expired'
      ? 'Tu plan venció: conservás acceso de lectura al panel, pero las integraciones y cambios quedan bloqueados hasta reactivarlo.'
      : isFreePlan()
        ? 'Estás en Free: podés ver el panel, pero para crear clientes, proyectos, vincular WhatsApp y medir leads reales necesitás Starter o superior.'
      : 'Los teléfonos de leads son editables manualmente para evitar LID de WhatsApp. La exportación usa el número cargado/corregido.';
  }

  const upgradeBanner = document.querySelector('[data-upgrade-banner]');
  if (upgradeBanner) upgradeBanner.classList.toggle('hidden', !isFreePlan());

  document.querySelectorAll('[data-open-modal="client"]').forEach(btn => {
    btn.disabled = !capabilities.canCreateClients;
    btn.title = capabilities.canCreateClients ? '' : 'Disponible desde Starter';
  });
  document.querySelectorAll('[data-open-modal="project"]').forEach(btn => {
    btn.disabled = !capabilities.canCreateProjects;
    btn.title = capabilities.canCreateProjects ? '' : 'Disponible desde Starter';
  });
  const waSubmit = document.querySelector('[data-whatsapp-form] button[type="submit"]');
  if (waSubmit) {
    waSubmit.disabled = !capabilities.canConnectWhatsapp;
    waSubmit.textContent = capabilities.canConnectWhatsapp ? 'Vincular nuevo WhatsApp' : 'Disponible desde Starter';
    waSubmit.title = capabilities.canConnectWhatsapp ? '' : 'Actualizá a Starter o superior para vincular WhatsApp';
  }

  renderExportGate();
}

function leadRow(lead) {
  const s = TLUtils.statusClass(lead.status);
  const m = TLUtils.statusClass(lead.metaStatus);
  const purchaseRate = lead.purchaseRate ?? 0;
  return `
    <tr>
      <td><div class="lead-code"><strong>${escapeHtml(lead.code)}</strong><span>${escapeHtml(lead.source || lead.buttonSource || lead.originButton || "landing")}</span></div></td>
      <td>${leadPhoneCell(lead)}</td>
      <td>${escapeHtml(lead.client || '-')}</td>
      <td>${escapeHtml(lead.project || '-')}</td>
      <td><span class="tag ${s}">${escapeHtml(lead.status || '-')}</span></td>
      <td><span class="tag ${m}">${escapeHtml(lead.metaStatus || '-')}</span></td>
      <td>${lead.incomingMessages ?? lead.incomingMessageCount ?? 0}</td>
      <td>${lead.paymentProofs ?? 0}</td>
      <td>${lead.purchasesConfirmed ?? 0}</td>
      <td>${purchaseRate}%</td>
      <td>${TLUtils.formatDate(lead.confirmedAt || lead.createdAt)}</td>
    </tr>
  `;
}

function renderBilling() {
  const agency = state.dashboard?.agency || user.agency || {};
  const plan = state.dashboard?.plan || {};
  const metrics = state.dashboard?.metrics || {};

  const status = document.querySelector('[data-plan-status]');
  if (status) {
    status.className = `status ${agency.status === 'active' ? 'active' : 'pending'}`;
    status.textContent = agency.status || 'pendiente';
  }

  const set = (selector, value) => {
    const el = document.querySelector(selector);
    if (el) el.textContent = value;
  };

  set('[data-billing-plan]', plan.name || agency.plan || 'Starter');
  set('[data-billing-plan-title]', plan.title || agency.planStatus || 'Plan actual');
  set('[data-billing-expiry]', TLUtils.formatDate(agency.expiresAt));
  set('[data-billing-clients]', `${metrics.clients || 0} / ${plan.clientsLimit ?? '∞'}`);
  set('[data-billing-projects]', `${metrics.projects || 0} / ${plan.projectsLimit ?? '∞'}`);
  set('[data-billing-whatsapp]', `${state.dashboard?.usage?.whatsappConnections ?? state.whatsappSessions.length ?? 0} / ${plan.whatsappLimit ?? '∞'}`);
  set('[data-billing-leads]', `${metrics.confirmed || 0} leads reales`);

  const features = document.querySelector('[data-billing-features]');
  if (features) {
    features.innerHTML = (plan.features || []).map(feature => `
      <article class="soft client-card">
        <strong>${escapeHtml(feature)}</strong>
        <p>Incluido en tu plan actual.</p>
      </article>
    `).join('');
  }
}

function renderLeads() {
  const recent = state.dashboard?.recent || [];
  document.querySelector('[data-recent-leads]').innerHTML = recent.length
    ? recent.slice(0, 8).map((lead) => `
      <tr>
        <td><div class="lead-code"><strong>${escapeHtml(lead.code)}</strong><span>${escapeHtml(lead.source || lead.buttonSource || lead.originButton || "landing")}</span></div></td>
        <td>${leadPhoneCell(lead)}</td>
        <td>${escapeHtml(lead.client || '-')}</td>
        <td>${escapeHtml(lead.project || '-')}</td>
        <td><span class="tag ${TLUtils.statusClass(lead.status)}">${escapeHtml(lead.status || '-')}</span></td>
        <td><span class="tag ${TLUtils.statusClass(lead.metaStatus)}">${escapeHtml(lead.metaStatus || '-')}</span></td>
        <td>${lead.incomingMessages ?? 0}</td>
        <td>${lead.purchasesConfirmed ?? 0}</td>
        <td>${TLUtils.formatDate(lead.confirmedAt || lead.createdAt)}</td>
      </tr>`).join('')
    : '<tr><td colspan="9">Todavía no hay leads.</td></tr>';

  document.querySelector('[data-leads-table]').innerHTML = state.leads.length
    ? state.leads.map(leadRow).join('')
    : '<tr><td colspan="11">Todavía no hay leads en este período.</td></tr>';

  bindLeadPhoneButtons();
}

function renderClientSelects() {
  const options = state.clients.length
    ? state.clients.map(c => `<option value="${escapeHtml(c.id)}">${escapeHtml(c.name)}</option>`).join('')
    : '<option value="">Primero creá un cliente</option>';

  const clientSelect = document.querySelector('[data-client-select]');
  if (clientSelect) clientSelect.innerHTML = options;

  const waClientSelect = document.querySelector('[data-wa-client-select]');
  if (waClientSelect) waClientSelect.innerHTML = options;

  renderWhatsappSessionSelect();
}

function renderClients() {
  const wrap = document.querySelector('[data-clients-grid]');
  wrap.innerHTML = state.clients.length ? state.clients.map(c => `
    <article class="soft client-card">
      <h3>${escapeHtml(c.name)}</h3>
      <p>${escapeHtml(c.email || 'Sin email')}</p>
      <p>${escapeHtml(c.phone || 'Sin teléfono')}</p>
      <span class="status ${c.status === 'active' ? 'active' : 'pending'}">${escapeHtml(c.status || 'active')}</span>
      <div class="actions" style="margin-top:14px">
        <button class="btn btn-secondary btn-small" data-edit-client="${c.id}">Editar</button>
        <button class="btn btn-danger btn-small" data-delete-client="${c.id}">Eliminar</button>
      </div>
    </article>
  `).join('') : '<p class="muted">No hay clientes todavía.</p>';

  wrap.querySelectorAll('[data-edit-client]').forEach(btn => {
    btn.addEventListener('click', () => openClientModal(btn.dataset.editClient));
  });

  wrap.querySelectorAll('[data-delete-client]').forEach(btn => {
    btn.addEventListener('click', () => deleteClient(btn.dataset.deleteClient));
  });

  renderClientSelects();
}

function renderWhatsappSessionSelect(selectedSessionId = '') {
  const select = document.querySelector('[data-whatsapp-session-select]');
  if (!select) return;

  const selectedClientId = document.querySelector('[data-client-select]')?.value || '';
  const sessions = state.whatsappSessions.filter(session =>
    !selectedClientId || !session.clientId || session.clientId === selectedClientId
  );

  select.innerHTML = sessions.length
    ? sessions.map(session => `<option value="${escapeHtml(session.id)}">${escapeHtml(sessionLabel(session))} · ${escapeHtml(session.status || 'disconnected')}</option>`).join('')
    : '<option value="">Primero vinculá un WhatsApp para este cliente</option>';

  if (selectedSessionId) select.value = selectedSessionId;
}

function domainsDisplay(value) {
  const items = String(value || '')
    .split(/[\s,;]+/)
    .map(item => item.trim())
    .filter(Boolean);

  return items.length ? items.map(escapeHtml).join('<br>') : '-';
}

function sdkSnippet(project) {
  const api = location.origin;
  return `<a
  href="#"
  data-truelead-whatsapp
  data-truelead-source="hero"
  data-truelead-message="Hola, quiero recibir información. Mi código es: {{code}}">
  Enviar WhatsApp
</a>

<script
  src="${api}/sdk/truelead.js"
  data-project="${project.publicId}"
  data-api="${api}">
<\/script>`;
}

function renderProjects() {
  const wrap = document.querySelector('[data-projects-grid]');
  wrap.innerHTML = state.projects.length ? state.projects.map(p => `
    <article class="soft client-card">
      <h3>${escapeHtml(p.name)}</h3>
      <p>Public ID: <strong>${escapeHtml(p.publicId)}</strong></p>
      <p>Cliente: ${escapeHtml(clientName(p.clientId))}</p>
      <p>Medición: <strong>${escapeHtml(p.trackingMode || 'landing')}</strong></p>
      ${p.trackingMode === 'cloud_api'
        ? `<p>Cloud API: WABA ${escapeHtml(p.metaWabaId || '-')} · Phone ID ${escapeHtml(p.metaPhoneNumberId || '-')}</p>`
        : `<p>WhatsApp vinculado: ${escapeHtml(p.whatsappLinkedLabel || 'Sin etiqueta')} ${p.whatsappLinkedNumber ? `· ${escapeHtml(p.whatsappLinkedNumber)}` : ''}</p>
           <p>Estado WhatsApp: <span class="tag ${TLUtils.statusClass(p.whatsappLinkedStatus)}">${escapeHtml(p.whatsappLinkedStatus || 'disconnected')}</span></p>
           <p>Dominios autorizados:<br>${domainsDisplay(p.domain)}</p>`}
      <p>Meta: ${p.metaDatasetId || p.metaPixelId ? `Dataset ${escapeHtml(p.metaDatasetId || p.metaPixelId)} · ` : ''}${p.metaCapiConfigured ? '<span class="tag green">CAPI configurada</span>' : '<span class="tag yellow">Sin CAPI</span>'}</p>
      <span class="status ${p.status === 'active' ? 'active' : 'pending'}">${escapeHtml(p.status || 'active')}</span>
      ${p.trackingMode !== 'landing' ? `<div class="notice subtle" style="margin-top:12px">Cloud API · Phone Number ID ${escapeHtml(p.metaPhoneNumberId || 'pendiente')}</div>` : ''}
      ${p.trackingMode !== 'cloud_api' ? `<textarea rows="10" readonly style="margin-top:12px">${sdkSnippet(p)}</textarea>` : ''}
      <div class="actions" style="margin-top:14px">
        <button class="btn btn-secondary btn-small" data-edit-project="${p.id}">Editar</button>
        <button class="btn btn-danger btn-small" data-delete-project="${p.id}">Eliminar</button>
      </div>
    </article>
  `).join('') : '<p class="muted">No hay proyectos todavía. Primero creá un cliente y vinculá WhatsApp.</p>';

  wrap.querySelectorAll('[data-edit-project]').forEach(btn => {
    btn.addEventListener('click', () => openProjectModal(btn.dataset.editProject));
  });

  wrap.querySelectorAll('[data-delete-project]').forEach(btn => {
    btn.addEventListener('click', () => deleteProject(btn.dataset.deleteProject));
  });
}

function purchaseRow(purchase) {
  const status = purchase.status || 'proof_received';
  const amount = Number(purchase.value || 0) > 0
    ? `${escapeHtml(purchase.currency || 'ARS')} ${Number(purchase.value).toLocaleString('es-AR')}`
    : '-';
  const actions = status === 'proof_received'
    ? `<button class="btn btn-primary btn-small" data-purchase-confirm="${escapeHtml(purchase.id)}">Validar compra</button>
       <button class="btn btn-danger btn-small" data-purchase-reject="${escapeHtml(purchase.id)}">Rechazar</button>`
    : status === 'purchase_confirmed' && Number(purchase.value || 0) <= 0
      ? `<button class="btn btn-secondary btn-small" data-purchase-confirm="${escapeHtml(purchase.id)}">Agregar importe</button>`
      : '<span class="muted">Sin acciones pendientes</span>';
  return `
    <tr>
      <td><strong>${escapeHtml(purchase.code || '-')}</strong></td>
      <td>${escapeHtml(purchase.client || '-')}</td>
      <td>${escapeHtml(purchase.project || '-')}</td>
      <td>${escapeHtml(purchase.proofType || purchase.mimeType || '-')}</td>
      <td>${amount}</td>
      <td><span class="tag ${TLUtils.statusClass(status)}">${escapeHtml(status)}</span></td>
      <td><span class="tag ${TLUtils.statusClass(purchase.metaStatus)}">${escapeHtml(purchase.metaStatus || '-')}</span></td>
      <td><strong>${escapeHtml(purchase.phoneDisplay || (purchase.whatsappFromLast4 ? `••••${purchase.whatsappFromLast4}` : '-'))}</strong></td>
      <td>${TLUtils.formatDate(purchase.receivedAt || purchase.createdAt)}</td>
      <td>
        <div class="actions">
          ${actions}
        </div>
      </td>
    </tr>
  `;
}

function renderPurchases() {
  const body = document.querySelector('[data-purchases-table]');
  if (!body) return;

  body.innerHTML = state.purchases.length
    ? state.purchases.map(purchaseRow).join('')
    : '<tr><td colspan="10">Todavía no hay comprobantes recibidos en este período.</td></tr>';

  body.querySelectorAll('[data-purchase-confirm]').forEach((button) => {
    button.addEventListener('click', () => updatePurchase(button.dataset.purchaseConfirm, 'purchase_confirmed'));
  });

  body.querySelectorAll('[data-purchase-reject]').forEach((button) => {
    button.addEventListener('click', () => updatePurchase(button.dataset.purchaseReject, 'rejected'));
  });
}

function renderConversionJobs() {
  const body = document.querySelector('[data-meta-jobs-table]');
  if (!body) return;
  body.innerHTML = state.conversionJobs.length
    ? state.conversionJobs.map((job) => `
      <tr>
        <td><strong>${escapeHtml(job.eventName || '-')}</strong></td>
        <td>${escapeHtml(job.code || '-')}</td>
        <td>${escapeHtml(job.project || '-')}</td>
        <td><span class="tag ${TLUtils.statusClass(job.status)}">${escapeHtml(job.status || '-')}</span></td>
        <td>${Number(job.attempts || 0)}</td>
        <td>${escapeHtml(job.lastError || '-')}</td>
        <td>${TLUtils.formatDate(job.sentAt || job.createdAt)}</td>
        <td>${['failed', 'skipped'].includes(job.status)
          ? `<button class="btn btn-secondary btn-small" data-retry-meta="${escapeHtml(job.id)}">Reintentar</button>`
          : '<span class="muted">—</span>'}</td>
      </tr>
    `).join('')
    : '<tr><td colspan="8">Todavía no hay eventos CAPI en este período.</td></tr>';

  body.querySelectorAll('[data-retry-meta]').forEach((button) => {
    button.addEventListener('click', async () => {
      button.disabled = true;
      try {
        await TrueLeadAPI.post(`/api/agency/conversion-jobs/${button.dataset.retryMeta}/retry`, {});
        TLUtils.showMessage(messageBox, 'Evento encolado nuevamente.', 'success');
        await loadAll();
      } catch (error) {
        TLUtils.showMessage(messageBox, error.message, 'error');
      } finally {
        button.disabled = false;
      }
    });
  });
}

function chooseActiveWhatsapp() {
  return state.whatsappSessions.find(s => s.qrDataUrl) ||
    state.whatsappSessions.find(s => s.status === 'connected') ||
    state.whatsappSessions[0] ||
    null;
}

function renderWhatsapp() {
  const s = state.whatsapp || chooseActiveWhatsapp() || {};
  const connectedCount = state.whatsappSessions.filter(item => item.status === 'connected').length;
  const cls = s.status === 'connected' ? 'active' : (s.status === 'qr' ? 'pending' : 'pending');

  document.querySelectorAll('[data-wa-status], [data-wa-status-2]').forEach(el => {
    el.className = `status ${cls}`;
    el.textContent = connectedCount
      ? `${connectedCount} conectado${connectedCount === 1 ? '' : 's'}`
      : (s.status || 'sin conectar');
  });

  const copy = s.status === 'connected'
    ? `Conectado: ${sessionLabel(s)}`
    : s.status === 'qr'
      ? `QR listo para ${sessionLabel(s)}.`
      : s.status === 'connecting'
        ? `Conectando ${sessionLabel(s)}...`
        : 'Todavía no hay WhatsApp conectado.';

  const copy1 = document.querySelector('[data-wa-copy]');
  const copy2 = document.querySelector('[data-wa-copy-2]');
  if (copy1) copy1.textContent = copy;
  if (copy2) copy2.textContent = s.qrDataUrl ? 'QR real generado. Escanealo con el teléfono del cliente.' : copy;

  document.querySelectorAll('[data-wa-qr-img]').forEach((img) => {
    if (s.qrDataUrl) {
      img.src = s.qrDataUrl;
      img.classList.remove('hidden');
    } else {
      img.removeAttribute('src');
      img.classList.add('hidden');
    }
  });

  document.querySelectorAll('[data-wa-qr-box]').forEach((box) => {
    box.innerHTML = '';
    box.classList.remove('is-connected', 'is-empty', 'is-connecting');

    if (s.qrDataUrl) {
      box.classList.add('hidden');
      return;
    }

    box.classList.remove('hidden');

    if (s.status === 'connected') {
      box.classList.add('is-connected');
      box.innerHTML = `
        <div class="wa-preview-icon">WA</div>
        <div class="wa-preview-copy">
          <strong>${escapeHtml(s.label || 'WhatsApp conectado')}</strong>
          <span>${escapeHtml(s.number || 'Número vinculado')}</span>
        </div>
      `;
    } else if (s.status === 'connecting') {
      box.classList.add('is-connecting');
    } else {
      box.classList.add('is-empty');
    }
  });

  renderWhatsappSessions();
  renderWhatsappSessionSelect();
}

function renderWhatsappSessions() {
  const grid = document.querySelector('[data-whatsapp-sessions-grid]');
  if (!grid) return;

  grid.innerHTML = state.whatsappSessions.length
    ? state.whatsappSessions.map(session => `
      <article class="soft client-card">
        <div class="panel-head">
          <div>
            <h3>${escapeHtml(session.label || 'WhatsApp')}</h3>
            <p>${escapeHtml(session.client || clientName(session.clientId))}</p>
          </div>
          <span class="tag ${TLUtils.statusClass(session.status)}">${escapeHtml(session.status || 'disconnected')}</span>
        </div>
        <p>Número: ${escapeHtml(session.number || 'Pendiente de vincular')}</p>
        <p>Última actividad: ${TLUtils.formatDate(session.lastActivityAt || session.updatedAt)}</p>
        ${session.lastError ? `<p class="muted">Error: ${escapeHtml(session.lastError)}</p>` : ''}
        <div class="actions">
          <button class="btn btn-primary btn-small" ${planCapabilities().canConnectWhatsapp ? `data-session-qr="${escapeHtml(session.id)}"` : 'disabled title="Disponible desde Starter"'}>Generar QR / Reconectar</button>
          <button class="btn btn-danger btn-small" data-session-disconnect="${escapeHtml(session.id)}">Desvincular</button>
        </div>
      </article>
    `).join('')
    : '<p class="muted">Todavía no hay WhatsApps vinculados. Elegí un cliente y generá el primer QR.</p>';

  grid.querySelectorAll('[data-session-qr]').forEach(button => {
    button.addEventListener('click', () => requestQrForSession(button.dataset.sessionQr));
  });

  grid.querySelectorAll('[data-session-disconnect]').forEach(button => {
    button.addEventListener('click', () => disconnectSession(button.dataset.sessionDisconnect));
  });
}

async function loadAll() {
  const query = rangeQuery();
  try {
    const [dashboard, clients, projects, leads, conversionJobs, purchases, whatsapp] = await Promise.all([
      TrueLeadAPI.get(`/api/agency/dashboard?${query}`),
      TrueLeadAPI.get('/api/agency/clients'),
      TrueLeadAPI.get('/api/agency/projects'),
      TrueLeadAPI.get(`/api/agency/preleads?${query}`),
      TrueLeadAPI.get(`/api/agency/conversion-jobs?${query}`),
      TrueLeadAPI.get(`/api/agency/purchases?${query}`),
      TrueLeadAPI.get('/api/whatsapp/sessions')
    ]);
    state.dashboard = dashboard;
    state.clients = clients.clients || [];
    state.projects = projects.projects || [];
    state.leads = leads.leads || [];
    state.conversionJobs = conversionJobs.jobs || [];
    state.purchases = purchases.purchases || [];
    state.whatsappSessions = whatsapp.sessions || [];
    state.whatsapp = chooseActiveWhatsapp();
    renderMetrics();
    renderBilling();
    renderLeads();
    renderClients();
    renderProjects();
    window.TrueLeadLandingBuilder?.refresh(state.projects, planCapabilities());
    renderConversionJobs();
    renderPurchases();
    renderWhatsapp();
  } catch (error) {
    TLUtils.showMessage(messageBox, error.message, 'error');
    if (String(error.message).includes('No autenticado')) location.href = '/login';
  }
}

let liveRefreshRunning = false;
async function refreshLiveData() {
  if (liveRefreshRunning) return;
  if (document.hidden) return;
  if (document.querySelector('.modal-backdrop.open')) return;

  liveRefreshRunning = true;
  const query = rangeQuery();
  try {
    const [dashboard, leads, conversionJobs, purchases, whatsapp] = await Promise.all([
      TrueLeadAPI.get(`/api/agency/dashboard?${query}`),
      TrueLeadAPI.get(`/api/agency/preleads?${query}`),
      TrueLeadAPI.get(`/api/agency/conversion-jobs?${query}`),
      TrueLeadAPI.get(`/api/agency/purchases?${query}`),
      TrueLeadAPI.get('/api/whatsapp/sessions')
    ]);
    state.dashboard = dashboard;
    state.leads = leads.leads || [];
    state.conversionJobs = conversionJobs.jobs || [];
    state.purchases = purchases.purchases || [];
    state.whatsappSessions = whatsapp.sessions || [];
    state.whatsapp = chooseActiveWhatsapp();
    renderMetrics();
    renderBilling();
    renderLeads();
    renderConversionJobs();
    renderPurchases();
    renderWhatsapp();
  } catch (error) {
    if (String(error.message).includes('No autenticado')) location.href = '/login';
  } finally {
    liveRefreshRunning = false;
  }
}


async function updatePurchase(id, status) {
  let value = 0;
  let currency = 'ARS';
  let notes = 'Compra validada desde panel agencia.';

  if (status === 'purchase_confirmed') {
    const purchase = state.purchases.find((item) => item.id === id);
    const amountInput = prompt('Monto de la compra (0 valida solo en TrueLead y no envía Purchase a Meta):', String(purchase?.value || 0));
    if (amountInput === null) return;
    value = Number(String(amountInput).replace(',', '.'));
    if (!Number.isFinite(value) || value < 0) {
      return TLUtils.showMessage(messageBox, 'Ingresá un monto válido, igual o mayor que 0.', 'error');
    }
    const currencyInput = prompt('Moneda ISO de 3 letras:', purchase?.currency || projectCurrency(purchase?.projectId) || 'ARS');
    if (currencyInput === null) return;
    currency = String(currencyInput).trim().toUpperCase();
    if (!/^[A-Z]{3}$/.test(currency)) {
      return TLUtils.showMessage(messageBox, 'Ingresá una moneda ISO válida, por ejemplo ARS o USD.', 'error');
    }
  } else {
    notes = prompt('Motivo / nota:', 'Comprobante rechazado') || '';
  }

  try {
    await TrueLeadAPI.patch(`/api/agency/purchases/${id}/status`, { status, notes, value, currency });
    TLUtils.showMessage(messageBox, status === 'purchase_confirmed' ? 'Compra validada correctamente.' : 'Comprobante actualizado.', 'success');
    await loadAll();
  } catch (error) {
    TLUtils.showMessage(messageBox, error.message, 'error');
  }
}


function openClientModal(clientId = '') {
  const modal = modalByName('client');
  const form = document.querySelector('[data-client-form]');
  const title = document.querySelector('[data-client-modal-title]');
  if (!modal || !form) return;

  form.reset();
  form.dataset.editId = clientId || '';
  const client = state.clients.find(c => c.id === clientId);
  if (title) title.textContent = client ? 'Editar cliente' : 'Nuevo cliente';

  if (client) {
    setField(form, 'name', client.name);
    setField(form, 'email', client.email);
    setField(form, 'phone', client.phone);
    setField(form, 'notes', client.notes);
  }

  modal.classList.add('open');
}

function openProjectModal(projectId = '') {
  const modal = modalByName('project');
  const form = document.querySelector('[data-project-form]');
  const title = document.querySelector('[data-project-modal-title]');
  if (!modal || !form) return;

  form.reset();
  form.dataset.editId = projectId || '';
  const project = state.projects.find(p => p.id === projectId);
  if (title) title.textContent = project ? 'Editar proyecto' : 'Nuevo proyecto';

  renderClientSelects();

  if (project) {
    setField(form, 'clientId', project.clientId);
    renderWhatsappSessionSelect(project.whatsappSessionId);
    setField(form, 'whatsappSessionId', project.whatsappSessionId);
    setField(form, 'name', project.name);
    setField(form, 'trackingMode', project.trackingMode || 'landing');
    setField(form, 'domain', project.domain);
    setField(form, 'metaDatasetId', project.metaDatasetId || project.metaPixelId);
    setField(form, 'metaCurrency', project.metaCurrency || 'ARS');
    setField(form, 'metaWabaId', project.metaWabaId || '');
    setField(form, 'metaPhoneNumberId', project.metaPhoneNumberId || '');
    setField(form, 'metaAdIds', project.metaAdIds || '');
    setField(form, 'metaTestEventCode', project.metaTestEventCode);
    setField(form, 'metaCapiToken', '');
  } else {
    renderWhatsappSessionSelect();
  }

  updateProjectModeFields();

  const scrollArea = modal.querySelector('[data-project-modal-scroll]');
  if (scrollArea) scrollArea.scrollTop = 0;
  modal.classList.add('open');
}

function updateProjectModeFields() {
  const mode = document.querySelector('[data-project-form] [data-tracking-mode]')?.value || 'landing';
  const needsLanding = mode === 'landing' || mode === 'hybrid';
  const needsCloud = mode === 'cloud_api' || mode === 'hybrid';
  document.querySelector('[data-landing-config]')?.classList.toggle('hidden', !needsLanding);
  document.querySelector('[data-cloud-config]')?.classList.toggle('hidden', !needsCloud);
  const sessionSelect = document.querySelector('[data-whatsapp-session-select]');
  if (sessionSelect) sessionSelect.required = needsLanding;
  for (const name of ['metaWabaId', 'metaPhoneNumberId']) {
    const field = document.querySelector(`[data-project-form] [name="${name}"]`);
    if (field) field.required = needsCloud;
  }
}

async function deleteClient(clientId) {
  const client = state.clients.find(c => c.id === clientId);
  if (!client) return;
  const relatedProjects = state.projects.filter(p => p.clientId === clientId).length;
  const relatedWhatsApps = state.whatsappSessions.filter(s => s.clientId === clientId).length;
  const warning = relatedProjects || relatedWhatsApps
    ? `\n\nTambién se eliminarán/desasociarán ${relatedProjects} proyecto(s) y ${relatedWhatsApps} WhatsApp(s) vinculados a este cliente.`
    : '';

  if (!confirm(`¿Eliminar el cliente "${client.name}"?${warning}`)) return;

  try {
    await TrueLeadAPI.delete(`/api/agency/clients/${clientId}`);
    TLUtils.showMessage(messageBox, 'Cliente eliminado correctamente.', 'success');
    await loadAll();
  } catch (error) {
    TLUtils.showMessage(messageBox, error.message, 'error');
  }
}

async function deleteProject(projectId) {
  const project = state.projects.find(p => p.id === projectId);
  if (!project) return;
  if (!confirm(`¿Eliminar el proyecto "${project.name}"? Los leads históricos quedan guardados para estadísticas.`)) return;

  try {
    await TrueLeadAPI.delete(`/api/agency/projects/${projectId}`);
    TLUtils.showMessage(messageBox, 'Proyecto eliminado correctamente.', 'success');
    await loadAll();
  } catch (error) {
    TLUtils.showMessage(messageBox, error.message, 'error');
  }
}

document.querySelectorAll('[data-open-modal]').forEach(btn => btn.addEventListener('click', () => {
  if (btn.dataset.openModal === 'client') {
    if (!planCapabilities().canCreateClients) return TLUtils.showMessage(messageBox, paidPlanRequiredMessage('crear clientes'), 'error');
    return openClientModal();
  }
  if (btn.dataset.openModal === 'project') {
    if (!planCapabilities().canCreateProjects) return TLUtils.showMessage(messageBox, paidPlanRequiredMessage('crear proyectos'), 'error');
    return openProjectModal();
  }
  const modal = document.querySelector(`[data-modal="${btn.dataset.openModal}"]`);
  modal?.classList.add('open');
  renderWhatsappSessionSelect();
}));
document.querySelectorAll('[data-close-modal]').forEach(btn => btn.addEventListener('click', () => {
  btn.closest('.modal-backdrop')?.classList.remove('open');
}));

document.querySelector('[data-client-select]')?.addEventListener('change', renderWhatsappSessionSelect);
document.querySelector('[data-tracking-mode]')?.addEventListener('change', updateProjectModeFields);

document.querySelector('[data-client-form]')?.addEventListener('submit', async (event) => {
  event.preventDefault();
  if (!planCapabilities().canCreateClients) return TLUtils.showMessage(messageBox, paidPlanRequiredMessage('crear clientes'), 'error');
  const form = new FormData(event.target);
  const payload = Object.fromEntries(form.entries());
  const editId = event.target.dataset.editId || '';
  try {
    if (editId) {
      await TrueLeadAPI.put(`/api/agency/clients/${editId}`, payload);
      TLUtils.showMessage(messageBox, 'Cliente actualizado correctamente.', 'success');
    } else {
      await TrueLeadAPI.post('/api/agency/clients', payload);
      TLUtils.showMessage(messageBox, 'Cliente creado correctamente.', 'success');
    }
    event.target.reset();
    event.target.dataset.editId = '';
    closeModal(event.target.closest('.modal-backdrop'));
    await loadAll();
  } catch (error) {
    TLUtils.showMessage(messageBox, error.message, 'error');
  }
});

document.querySelector('[data-project-form]')?.addEventListener('submit', async (event) => {
  event.preventDefault();
  if (!planCapabilities().canCreateProjects) return TLUtils.showMessage(messageBox, paidPlanRequiredMessage('crear proyectos'), 'error');
  const form = new FormData(event.target);
  const payload = Object.fromEntries(form.entries());
  const editId = event.target.dataset.editId || '';
  try {
    if (editId) {
      await TrueLeadAPI.put(`/api/agency/projects/${editId}`, payload);
      TLUtils.showMessage(messageBox, 'Proyecto actualizado correctamente.', 'success');
    } else {
      await TrueLeadAPI.post('/api/agency/projects', payload);
      TLUtils.showMessage(messageBox, 'Proyecto creado correctamente.', 'success');
    }
    event.target.reset();
    event.target.dataset.editId = '';
    closeModal(event.target.closest('.modal-backdrop'));
    await loadAll();
  } catch (error) {
    TLUtils.showMessage(messageBox, error.message, 'error');
  }
});

document.querySelector('[data-confirm-form]')?.addEventListener('submit', async (event) => {
  event.preventDefault();
  const form = new FormData(event.target);
  try {
    const code = String(form.get('code')).trim().toUpperCase();
    await TrueLeadAPI.post(`/api/preleads/${encodeURIComponent(code)}/confirm`, {
      phone: form.get('phone'),
      sendToMeta: form.get('sendToMeta') === 'on',
      source: 'manual_panel'
    });
    event.target.reset();
    TLUtils.showMessage(messageBox, `Lead ${code} confirmado.`, 'success');
    await loadAll();
  } catch (error) {
    TLUtils.showMessage(messageBox, error.message, 'error');
  }
});


document.querySelector('[data-lead-phone-form]')?.addEventListener('submit', async (event) => {
  event.preventDefault();
  if (!planCapabilities().canEditLeadPhones) return TLUtils.showMessage(messageBox, paidPlanRequiredMessage('editar teléfonos'), 'error');
  const leadId = event.target.dataset.leadId || '';
  const form = new FormData(event.target);
  try {
    await TrueLeadAPI.patch(`/api/agency/preleads/${leadId}/phone`, {
      phone: form.get('phone')
    });
    closeModal(event.target.closest('.modal-backdrop'));
    event.target.reset();
    event.target.dataset.leadId = '';
    TLUtils.showMessage(messageBox, 'Teléfono actualizado para este lead.', 'success');
    await loadAll();
  } catch (error) {
    TLUtils.showMessage(messageBox, error.message, 'error');
  }
});

document.querySelector('[data-whatsapp-form]')?.addEventListener('submit', async (event) => {
  event.preventDefault();
  if (!planCapabilities().canConnectWhatsapp) return TLUtils.showMessage(messageBox, paidPlanRequiredMessage('vincular WhatsApp'), 'error');
  const form = new FormData(event.target);
  const body = Object.fromEntries(form.entries());

  try {
    const data = await TrueLeadAPI.post('/api/whatsapp/request-qr', body);
    state.whatsapp = data.session;
    await loadAll();
    state.whatsapp = data.session;
    renderWhatsapp();
    TLUtils.showMessage(messageBox, data.message || 'QR solicitado.', 'success');
  } catch (error) {
    TLUtils.showMessage(messageBox, error.message, 'error');
  }
});

async function requestQrForSession(sessionId) {
  try {
    const session = state.whatsappSessions.find(item => item.id === sessionId);
    const data = await TrueLeadAPI.post('/api/whatsapp/request-qr', {
      sessionId,
      clientId: session?.clientId || '',
      label: session?.label || 'WhatsApp'
    });
    state.whatsapp = data.session;
    await loadAll();
    state.whatsapp = data.session;
    renderWhatsapp();
    TLUtils.showMessage(messageBox, data.message || 'QR solicitado.', 'success');
  } catch (error) {
    TLUtils.showMessage(messageBox, error.message, 'error');
  }
}

async function disconnectSession(sessionId) {
  const ok = confirm('¿Desvincular este WhatsApp? Se cerrará la sesión, se borrará el QR guardado y los proyectos que lo usaban quedarán sin WhatsApp asignado.');
  if (!ok) return;

  try {
    await TrueLeadAPI.post('/api/whatsapp/disconnect', { sessionId });
    await loadAll();
    TLUtils.showMessage(messageBox, 'WhatsApp desvinculado y eliminado del panel.', 'success');
  } catch (error) {
    TLUtils.showMessage(messageBox, error.message, 'error');
  }
}



function bindLeadPhoneButtons() {
  document.querySelectorAll('[data-edit-lead-phone]').forEach((button) => {
    button.addEventListener('click', () => openLeadPhoneModal(button.dataset.editLeadPhone));
  });
}

function findLeadById(id) {
  return [...(state.leads || []), ...(state.dashboard?.recent || [])].find((lead) => lead.id === id);
}

function openLeadPhoneModal(leadId) {
  const lead = findLeadById(leadId);
  if (!lead) return;
  const modal = modalByName('lead-phone');
  const form = document.querySelector('[data-lead-phone-form]');
  if (!modal || !form) return;

  form.dataset.leadId = leadId;
  setField(form, 'code', lead.code || '');
  setField(form, 'phone', lead.manualPhone || lead.phone || lead.whatsappFromPhone || '');
  const title = modal.querySelector('[data-lead-phone-title]');
  if (title) title.textContent = (lead.manualPhone || lead.phone) ? 'Editar teléfono del lead' : 'Agregar teléfono al lead';
  modal.classList.add('open');
}

async function downloadLeadExport(format) {
  if (!canExportLeads()) return TLUtils.showMessage(messageBox, paidPlanRequiredMessage('exportar bases'), 'error');
  const form = document.querySelector('[data-export-form]');
  const mode = form?.elements?.mode?.value || 'full';
  const params = new URLSearchParams();
  params.set('range', state.range.range || 'month');
  params.set('tzOffsetMinutes', String(new Date().getTimezoneOffset()));
  if (state.range.range === 'custom') {
    if (state.range.from) params.set('from', state.range.from);
    if (state.range.to) params.set('to', state.range.to);
  }
  params.set('mode', mode);
  params.set('format', format);

  try {
    const response = await fetch(TrueLeadAPI.buildUrl(`/api/agency/exports/leads?${params.toString()}`), {
      credentials: 'include'
    });

    if (!response.ok) {
      const data = await response.json().catch(() => ({}));
      throw new Error(data.error || `Error ${response.status}`);
    }

    const blob = await response.blob();
    const filename = exportFileNameFromResponse(response, `truelead_export.${format}`);
    const url = URL.createObjectURL(blob);
    const link = document.createElement('a');
    link.href = url;
    link.download = filename;
    document.body.appendChild(link);
    link.click();
    link.remove();
    URL.revokeObjectURL(url);
    TLUtils.showMessage(messageBox, `Exportación ${format.toUpperCase()} lista.`, 'success');
  } catch (error) {
    TLUtils.showMessage(messageBox, error.message, 'error');
  }
}

document.querySelectorAll('[data-export-format]').forEach(button => {
  button.addEventListener('click', () => downloadLeadExport(button.dataset.exportFormat || 'csv'));
});

document.querySelector('[data-open-wa]')?.addEventListener('click', () => setTab('whatsapp'));

window.addEventListener('truelead:project-updated', (event) => {
  const project = event.detail;
  if (!project?.id) return;
  const index = state.projects.findIndex((item) => item.id === project.id);
  if (index !== -1) state.projects[index] = { ...state.projects[index], ...project };
  renderProjects();
});

const rangeSelect = document.querySelector('[data-range-filter]');
const rangeFrom = document.querySelector('[data-range-from]');
const rangeTo = document.querySelector('[data-range-to]');
function updateRangeVisibility() {
  const custom = rangeSelect?.value === 'custom';
  rangeFrom?.classList.toggle('hidden', !custom);
  rangeTo?.classList.toggle('hidden', !custom);
}
rangeSelect?.addEventListener('change', updateRangeVisibility);
document.querySelector('[data-apply-range]')?.addEventListener('click', async () => {
  state.range.range = rangeSelect?.value || 'month';
  state.range.from = rangeFrom?.value || '';
  state.range.to = rangeTo?.value || '';
  updateRangeVisibility();
  await loadAll();
});
updateRangeVisibility();

loadAll();

setInterval(refreshLiveData, 10_000);
document.addEventListener('visibilitychange', () => {
  if (!document.hidden) refreshLiveData();
});


function scrollMainIntoViewOnMobile() {
  if (window.innerWidth > 900) return;
  const main = document.querySelector('.main');
  if (!main) return;
  setTimeout(() => {
    main.scrollIntoView({ behavior: 'smooth', block: 'start' });
  }, 80);
}
