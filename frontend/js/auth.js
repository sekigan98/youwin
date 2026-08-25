
const loginForm = document.querySelector('[data-login-form]');
const registerForm = document.querySelector('[data-register-form]');
const messageBox = document.querySelector('[data-message]');

async function redirectIfSessionIsActive(destination = 'client') {
  const savedUser = TrueLeadAPI.user();
  const hint = TrueLeadAPI.sessionHint?.() || {};
  if (!savedUser && !hint.loggedIn && !TrueLeadAPI.token()) return;

  try {
    const data = await TrueLeadAPI.get('/api/auth/me');
    const activeUser = data.user || savedUser;
    TrueLeadAPI.setSession(null, activeUser);

    if (destination === 'admin') {
      location.href = TrueLeadAPI.panelUrl('admin');
    } else {
      location.href = TrueLeadAPI.panelUrl('agency');
    }
  } catch (error) {
    TrueLeadAPI.clearSession();
  }
}


if (loginForm) {
  redirectIfSessionIsActive(loginForm.dataset.loginDestination || 'client');
  loginForm.addEventListener('submit', async (event) => {
    event.preventDefault();
    const form = new FormData(loginForm);
    const destination = loginForm.dataset.loginDestination || 'client';

    try {
      const data = await TrueLeadAPI.post('/api/auth/login', {
        email: form.get('email'),
        password: form.get('password')
      });

      if (destination === 'admin' && data.user.role !== 'admin') {
        TrueLeadAPI.clearSession();
        TLUtils.showMessage(messageBox, 'Este acceso es solo para administración interna de TrueLead.', 'error');
        return;
      }

      TrueLeadAPI.setSession(null, data.user);
      location.href = TrueLeadAPI.panelUrl(destination === 'admin' ? 'admin' : 'agency');
    } catch (error) {
      TLUtils.showMessage(messageBox, error.message, 'error');
    }
  });
}

if (registerForm) {
  registerForm.addEventListener('submit', async (event) => {
    event.preventDefault();
    const form = new FormData(registerForm);
    try {
      await TrueLeadAPI.post('/api/auth/register', {
        agencyName: form.get('agencyName'),
        name: form.get('name'),
        email: form.get('email'),
        password: form.get('password')
      });
      TLUtils.showMessage(messageBox, 'Cuenta creada. Te enviamos un email para activar el acceso Free al panel.', 'success');
      registerForm.reset();
    } catch (error) {
      TLUtils.showMessage(messageBox, error.message, 'error');
    }
  });
}
