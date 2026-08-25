import { isProduction, randomToken } from '../config.js';

export function parseCookies(header = '') {
  return String(header || '').split(';').reduce((cookies, pair) => {
    const index = pair.indexOf('=');
    if (index === -1) return cookies;
    const key = pair.slice(0, index).trim();
    const value = pair.slice(index + 1).trim();
    if (!key) return cookies;
    try {
      cookies[key] = decodeURIComponent(value);
    } catch {
      cookies[key] = value;
    }
    return cookies;
  }, {});
}

function cookieDomain() {
  const explicit = String(process.env.COOKIE_DOMAIN || '').trim();
  if (explicit && /^\.?[a-z0-9.-]+$/i.test(explicit)) return explicit;
  const appUrl = String(process.env.APP_URL || '');
  try {
    const hostname = new URL(appUrl).hostname;
    if (hostname === 'truelead.com.ar' || hostname.endsWith('.truelead.com.ar')) return '.truelead.com.ar';
  } catch {}
  return '';
}

function serializeCookie(name, value, options = {}) {
  const parts = [`${name}=${encodeURIComponent(value)}`];
  parts.push(`Path=${options.path || '/'}`);
  if (options.maxAge != null) parts.push(`Max-Age=${Math.max(0, Number(options.maxAge))}`);
  if (options.httpOnly) parts.push('HttpOnly');
  if (options.secure) parts.push('Secure');
  parts.push(`SameSite=${options.sameSite || 'Lax'}`);
  if (options.domain) parts.push(`Domain=${options.domain}`);
  return parts.join('; ');
}

export function setAuthCookies(res, token) {
  const csrfToken = randomToken(24);
  // La sesión queda host-only en app.truelead.com.ar. Los hints de marketing
  // usan cookies separadas y no necesitan recibir el JWT en todo subdominio.
  const shared = { domain: '', secure: isProduction, sameSite: 'Lax', maxAge: 30 * 24 * 60 * 60 };
  res.append('Set-Cookie', serializeCookie('tl_session', token, { ...shared, httpOnly: true }));
  res.append('Set-Cookie', serializeCookie('tl_csrf', csrfToken, { ...shared, httpOnly: false }));
  const legacyDomain = cookieDomain();
  if (legacyDomain) {
    res.append('Set-Cookie', serializeCookie('tl_session', '', { ...shared, domain: legacyDomain, maxAge: 0, httpOnly: true }));
    res.append('Set-Cookie', serializeCookie('tl_csrf', '', { ...shared, domain: legacyDomain, maxAge: 0, httpOnly: false }));
  }
  return csrfToken;
}

export function clearAuthCookies(res) {
  const legacyDomain = cookieDomain();
  const shared = { domain: '', secure: isProduction, sameSite: 'Lax', maxAge: 0 };
  res.append('Set-Cookie', serializeCookie('tl_session', '', { ...shared, httpOnly: true }));
  res.append('Set-Cookie', serializeCookie('tl_csrf', '', { ...shared, httpOnly: false }));
  if (legacyDomain) {
    res.append('Set-Cookie', serializeCookie('tl_session', '', { ...shared, domain: legacyDomain, httpOnly: true }));
    res.append('Set-Cookie', serializeCookie('tl_csrf', '', { ...shared, domain: legacyDomain, httpOnly: false }));
  }
}
