
const messageBox = document.querySelector('[data-message]');
const statusEl = document.querySelector('[data-connect-status]');
const qrImg = document.querySelector('[data-connect-qr-img]');
const qrBox = document.querySelector('[data-connect-qr-box]');

async function loadConnectStatus() {
  try {
    const data = await TrueLeadAPI.get('/api/whatsapp/status');
    renderStatus(data.session);
  } catch (error) {
    TLUtils.showMessage(messageBox, 'Para generar QR necesitás iniciar sesión.', 'error');
  }
}

function renderStatus(session = {}) {
  const cls = session.status === 'connected' ? 'active' : 'pending';
  statusEl.className = `status ${cls}`;
  statusEl.textContent = session.status || 'disconnected';

  if (session.qrDataUrl) {
    qrImg.src = session.qrDataUrl;
    qrImg.classList.remove('hidden');
    qrBox.classList.add('hidden');
  } else {
    qrImg.removeAttribute('src');
    qrImg.classList.add('hidden');
    qrBox.classList.remove('hidden');
  }
}

document.querySelector('[data-connect-request]')?.addEventListener('click', async () => {
  try {
    const data = await TrueLeadAPI.post('/api/whatsapp/request-qr', {});
    renderStatus(data.session);
    TLUtils.showMessage(messageBox, data.message || 'QR generado.', 'success');
  } catch (error) {
    TLUtils.showMessage(messageBox, error.message, 'error');
  }
});

document.querySelector('[data-connect-demo]')?.addEventListener('click', async () => {
  try {
    const data = await TrueLeadAPI.post('/api/whatsapp/reconnect', {});
    renderStatus(data.session);
    TLUtils.showMessage(messageBox, 'Reconexión solicitada. Si hace falta, se generará un QR nuevo.', 'success');
  } catch (error) {
    TLUtils.showMessage(messageBox, error.message, 'error');
  }
});

loadConnectStatus();

setInterval(loadConnectStatus, 5000);
