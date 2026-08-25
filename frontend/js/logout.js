function safeRedirectTarget(value) {
  if (!value) return '/login';
  try {
    const url = new URL(value, window.location.origin);
    const allowedOrigins = new Set([
      'https://truelead.com.ar',
      'https://www.truelead.com.ar',
      'https://app.truelead.com.ar',
      window.location.origin
    ]);
    return allowedOrigins.has(url.origin) && !url.username && !url.password ? url.href : '/login';
  } catch {
    return '/login';
  }
}

(async function logout() {
  await TrueLeadAPI.logout();
  const params = new URLSearchParams(window.location.search);
  const redirect = safeRedirectTarget(params.get('redirect'));
  window.location.replace(redirect);
})();
