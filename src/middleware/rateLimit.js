function clientKey(req) {
  return String(req.ip || req.socket?.remoteAddress || 'unknown');
}

export function createRateLimit({
  windowMs = 60_000,
  max = 60,
  keyGenerator = clientKey,
  message = 'Demasiadas solicitudes. Esperá un momento e intentá nuevamente.'
} = {}) {
  const buckets = new Map();

  const cleanup = setInterval(() => {
    const now = Date.now();
    for (const [key, bucket] of buckets.entries()) {
      if (bucket.resetAt <= now) buckets.delete(key);
    }
  }, Math.max(windowMs, 60_000));
  cleanup.unref?.();

  return function rateLimit(req, res, next) {
    const now = Date.now();
    const key = String(keyGenerator(req) || clientKey(req));
    let bucket = buckets.get(key);

    if (!bucket || bucket.resetAt <= now) {
      bucket = { count: 0, resetAt: now + windowMs };
      buckets.set(key, bucket);
    }

    bucket.count += 1;
    const remaining = Math.max(0, max - bucket.count);
    res.setHeader('RateLimit-Limit', String(max));
    res.setHeader('RateLimit-Remaining', String(remaining));
    res.setHeader('RateLimit-Reset', String(Math.ceil(bucket.resetAt / 1000)));

    if (bucket.count > max) {
      res.setHeader('Retry-After', String(Math.max(1, Math.ceil((bucket.resetAt - now) / 1000))));
      return res.status(429).json({ error: message });
    }

    return next();
  };
}

