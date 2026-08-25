(async function () {
  const hashParams = new URLSearchParams(location.hash.replace(/^#/, ''));
  const queryParams = new URLSearchParams(location.search);
  const token = hashParams.get('token') || queryParams.get('token') || '';
  if (token) history.replaceState(null, '', location.pathname);
  const message = document.querySelector('[data-message]');
  const title = document.querySelector('[data-verify-title]');
  const copy = document.querySelector('[data-verify-copy]');
  const link = document.querySelector('[data-login-link]');

  if (!token) {
    TLUtils.showMessage(message, 'Falta el token de activación.', 'error');
    title.textContent = 'No pudimos activar la cuenta';
    copy.textContent = 'El link de activación está incompleto.';
    return;
  }

  try {
    const data = await TrueLeadAPI.post('/api/auth/verify-email', { token });
    TLUtils.showMessage(message, data.message || 'Cuenta activada correctamente.', 'success');
    title.textContent = 'Cuenta activada';
    copy.textContent = 'Ya podés entrar al panel y vincular WhatsApp por QR.';
    link.classList.remove('hidden');
  } catch (error) {
    TLUtils.showMessage(message, error.message, 'error');
    title.textContent = 'No pudimos activar la cuenta';
    copy.textContent = 'El link puede estar vencido o ya usado. Podés solicitar otro desde el registro/login.';
  }
})();
