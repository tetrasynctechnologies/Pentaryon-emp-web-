const crypto = require('node:crypto');

// In-memory sliding-window store for rate limiting
const loginAttempts = new Map(); // ip -> { count, firstAttemptTime, blockedUntil }
const accountAttempts = new Map(); // username -> { count, firstAttemptTime, blockedUntil }
const registerAttempts = new Map(); // ip -> { count, firstAttemptTime }

// Clean up stale rate-limiting entries every 5 minutes
setInterval(() => {
  const now = Date.now();
  for (const [ip, data] of loginAttempts.entries()) {
    if (now > (data.blockedUntil || (data.firstAttemptTime + 5 * 60 * 1000))) {
      loginAttempts.delete(ip);
    }
  }
  for (const [u, data] of accountAttempts.entries()) {
    if (now > (data.blockedUntil || (data.firstAttemptTime + 5 * 60 * 1000))) {
      accountAttempts.delete(u);
    }
  }
  for (const [ip, data] of registerAttempts.entries()) {
    if (now > (data.firstAttemptTime + 10 * 60 * 1000)) {
      registerAttempts.delete(ip);
    }
  }
}, 5 * 60 * 1000).unref();

/**
 * Rate Limiter for Login (Defends against brute-force, distributed botnets, and CPU starvation DoS)
 * Threshold: Max 10 failed attempts within 5 minutes per IP OR per target username;
 * blocks access for 5 minutes.
 */
function loginRateLimiter(req, res, next) {
  const ip = req.ip || req.socket.remoteAddress || 'unknown';
  const username = req.body?.username && typeof req.body.username === 'string'
    ? req.body.username.trim().toLowerCase()
    : null;
  const now = Date.now();

  // 1. Check IP-level lockout
  const ipEntry = loginAttempts.get(ip);
  if (ipEntry) {
    if (ipEntry.blockedUntil && now < ipEntry.blockedUntil) {
      const waitMinutes = Math.ceil((ipEntry.blockedUntil - now) / 60000);
      return res.status(429).json({
        error: `Too many failed login attempts from this network. Access temporarily locked. Please try again in ${waitMinutes} minute(s).`
      });
    }
    if (now - ipEntry.firstAttemptTime > 5 * 60 * 1000) {
      loginAttempts.set(ip, { count: 0, firstAttemptTime: now, blockedUntil: 0 });
    }
  }

  // 2. Check Account-level lockout (Defeats distributed proxy rotation against specific accounts)
  if (username) {
    const accEntry = accountAttempts.get(username);
    if (accEntry) {
      if (accEntry.blockedUntil && now < accEntry.blockedUntil) {
        const waitMinutes = Math.ceil((accEntry.blockedUntil - now) / 60000);
        return res.status(429).json({
          error: `Too many failed login attempts for this user account. For security, account sign-in is temporarily locked. Please try again in ${waitMinutes} minute(s).`
        });
      }
      if (now - accEntry.firstAttemptTime > 5 * 60 * 1000) {
        accountAttempts.set(username, { count: 0, firstAttemptTime: now, blockedUntil: 0 });
      }
    }
  }

  next();
}

/**
 * Record a failed login attempt for both IP and target username
 */
function recordFailedLogin(req, username = null) {
  const ip = req.ip || req.socket.remoteAddress || 'unknown';
  const now = Date.now();

  // IP counter
  const ipEntry = loginAttempts.get(ip) || { count: 0, firstAttemptTime: now, blockedUntil: 0 };
  ipEntry.count += 1;
  if (ipEntry.count >= 10) {
    ipEntry.blockedUntil = now + 5 * 60 * 1000; // 5 minute lockout
  }
  loginAttempts.set(ip, ipEntry);

  // Target username counter
  const cleanUser = username && typeof username === 'string' ? username.trim().toLowerCase() : null;
  if (cleanUser) {
    const accEntry = accountAttempts.get(cleanUser) || { count: 0, firstAttemptTime: now, blockedUntil: 0 };
    accEntry.count += 1;
    if (accEntry.count >= 10) {
      accEntry.blockedUntil = now + 5 * 60 * 1000; // 5 minute account lockout
    }
    accountAttempts.set(cleanUser, accEntry);
  }
}

/**
 * Reset failed login counters upon successful authentication
 */
function recordSuccessfulLogin(req, username = null) {
  const ip = req.ip || req.socket.remoteAddress || 'unknown';
  loginAttempts.delete(ip);

  const cleanUser = username && typeof username === 'string' ? username.trim().toLowerCase() : null;
  if (cleanUser) {
    accountAttempts.delete(cleanUser);
  }
}

/**
 * Rate Limiter for Account Registration (Defends against account spamming)
 * Threshold: Max 5 registration submissions per IP per 10 minutes.
 */
function registerRateLimiter(req, res, next) {
  const ip = req.ip || req.socket.remoteAddress || 'unknown';
  const now = Date.now();
  const entry = registerAttempts.get(ip);

  if (entry) {
    if (now - entry.firstAttemptTime < 10 * 60 * 1000) {
      if (entry.count >= 5) {
        return res.status(429).json({
          error: 'Registration rate limit exceeded. Please wait a few minutes before submitting additional account requests.'
        });
      }
      entry.count += 1;
    } else {
      registerAttempts.set(ip, { count: 1, firstAttemptTime: now });
    }
  } else {
    registerAttempts.set(ip, { count: 1, firstAttemptTime: now });
  }

  next();
}

/**
 * CSRF Defense: Origin / Referer & Sec-Fetch-Site Validation Middleware
 * Enforces that mutative state requests (POST, PATCH, DELETE, PUT)
 * originate strictly from the same host.
 */
function originGuard(req, res, next) {
  const mutativeMethods = ['POST', 'PATCH', 'DELETE', 'PUT'];
  if (!mutativeMethods.includes(req.method)) {
    return next();
  }

  // 1. Strict Sec-Fetch-Site check
  const secFetchSite = req.headers['sec-fetch-site'];
  if (secFetchSite && secFetchSite === 'cross-site') {
    return res.status(403).json({ error: 'Cross-Site Request Blocked: Sec-Fetch-Site cross-site violation.' });
  }

  // 2. Origin & Referer matching host
  const origin = req.headers.origin || req.headers.referer;
  const host = req.headers['x-forwarded-host'] || req.headers.host;

  if (origin && host) {
    try {
      const originUrl = new URL(origin);
      const isLocal = (originUrl.hostname === 'localhost' || originUrl.hostname === '127.0.0.1') &&
                      (host.startsWith('localhost') || host.startsWith('127.0.0.1'));
      const isVercel = originUrl.hostname.endsWith('.vercel.app') && host.endsWith('.vercel.app');
      if (originUrl.host !== host && !isLocal && !isVercel) {
        return res.status(403).json({ error: 'Cross-Site Request Blocked: Origin mismatch detected.' });
      }
    } catch (_) {
      return res.status(403).json({ error: 'Cross-Site Request Blocked: Invalid request origin.' });
    }
  } else if (!origin && req.headers['sec-fetch-mode'] === 'navigate') {
    return res.status(403).json({ error: 'Cross-Site Request Blocked: Referrer required for mutative browser navigation.' });
  }

  next();
}

/**
 * Constant-time dummy verification
 * Computes scrypt hash on a dummy secret to ensure response timing
 * is identical whether the username exists or not, defeating timing attacks.
 */
const DUMMY_SALT = crypto.randomBytes(16).toString('hex');
const DUMMY_HASH = crypto.scryptSync('dummy_timing_protection_secret', DUMMY_SALT, 64).toString('hex');

function dummyVerifyPassword(password) {
  try {
    const calc = crypto.scryptSync(password || 'empty', DUMMY_SALT, 64).toString('hex');
    const a = Buffer.from(DUMMY_HASH, 'hex');
    const b = Buffer.from(calc, 'hex');
    crypto.timingSafeEqual(a, b);
  } catch (_) {}
}

/**
 * Sanitize text destined for audit logs to eliminate CRLF and terminal control sequences
 */
function sanitizeLogText(str, maxLength = 500) {
  if (typeof str !== 'string') return '';
  return str
    .replace(/[\r\n\x00-\x1f\x7f]/g, ' ')
    .replace(/\s+/g, ' ')
    .trim()
    .slice(0, maxLength);
}

/**
 * Test isolation helper to clear in-memory rate limiting tables
 */
function _resetRateLimits() {
  loginAttempts.clear();
  accountAttempts.clear();
  registerAttempts.clear();
}

module.exports = {
  loginRateLimiter,
  recordFailedLogin,
  recordSuccessfulLogin,
  registerRateLimiter,
  originGuard,
  dummyVerifyPassword,
  sanitizeLogText,
  _resetRateLimits
};
