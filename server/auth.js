const crypto = require('node:crypto');
const { db } = require('./db');
const config = require('./config');

const SESSION_TTL_MS = 7 * 24 * 60 * 60 * 1000; // 7 days

/**
 * Generate a cryptographically signed 64-hex session token.
 * 4 bytes userId (UInt32BE) + 4 bytes random nonce + 4 bytes timestamp (UInt32BE) + 20 bytes HMAC-SHA256 = 32 bytes (64 hex characters)
 * This allows stateful lookups in SQLite AND stateless verification across ephemeral serverless containers.
 */
function generateSignedSessionId(userId) {
  const timeSec = Math.floor(Date.now() / 1000);
  const buf = Buffer.alloc(12);
  buf.writeUInt32BE(userId, 0);
  crypto.randomBytes(4).copy(buf, 4);
  buf.writeUInt32BE(timeSec, 8);

  const hmac = crypto.createHmac('sha256', config.sessionSecret).update(buf).digest().subarray(0, 20);
  return Buffer.concat([buf, hmac]).toString('hex');
}

/**
 * Verify a signed 64-hex session token statelessly
 */
function verifySignedSessionId(sessionId) {
  if (!sessionId || typeof sessionId !== 'string' || !/^[a-f0-9]{64}$/i.test(sessionId)) {
    return null;
  }
  try {
    const raw = Buffer.from(sessionId, 'hex');
    const uId = raw.readUInt32BE(0);
    const tSec = raw.readUInt32BE(8);
    const hmacPart = raw.subarray(12);
    const expectedHmac = crypto.createHmac('sha256', config.sessionSecret).update(raw.subarray(0, 12)).digest().subarray(0, 20);

    if (hmacPart.length !== expectedHmac.length || !crypto.timingSafeEqual(hmacPart, expectedHmac)) {
      return null;
    }

    const ageMs = Date.now() - (tSec * 1000);
    if (ageMs < 0 || ageMs > SESSION_TTL_MS) {
      return null;
    }

    return uId;
  } catch (_) {
    return null;
  }
}

/**
 * Create a new cryptographically secure session
 */
function createSession(userId) {
  const sessionId = generateSignedSessionId(userId);
  const expiresAt = new Date(Date.now() + SESSION_TTL_MS).toISOString();

  const stmt = db.prepare('INSERT INTO sessions (id, user_id, expires_at) VALUES (?, ?, ?)');
  stmt.run(sessionId, userId, expiresAt);

  return { sessionId, expiresAt };
}

/**
 * Remove session on logout
 */
function deleteSession(sessionId) {
  if (!sessionId) return;
  try {
    db.prepare('DELETE FROM sessions WHERE id = ?').run(sessionId);
    db.prepare('INSERT OR IGNORE INTO revoked_sessions (id) VALUES (?)').run(sessionId);
  } catch (_) {}
}

/**
 * Retrieve user profile for valid active session
 */
function getSessionUser(sessionId) {
  if (!sessionId || typeof sessionId !== 'string') return null;
  // Strict format assertion: 64 hex characters
  if (!/^[a-f0-9]{64}$/i.test(sessionId)) return null;

  // Check if session has been revoked
  try {
    const isRevoked = db.prepare('SELECT id FROM revoked_sessions WHERE id = ?').get(sessionId);
    if (isRevoked) return null;
  } catch (_) {}

  const now = new Date().toISOString();
  
  // 1. Primary check: local database sessions table
  const stmt = db.prepare(`
    SELECT u.id, u.name, u.username, u.role, u.department, u.status, u.created_at, u.approved_at
    FROM sessions s
    JOIN users u ON s.user_id = u.id
    WHERE s.id = ? AND s.expires_at > ?
  `);
  
  const localSessionUser = stmt.get(sessionId, now);
  if (localSessionUser) {
    return localSessionUser;
  }

  // 2. Serverless multi-instance fallback: verify cryptographically signed token
  const verifiedUserId = verifySignedSessionId(sessionId);
  if (verifiedUserId) {
    const userStmt = db.prepare(`
      SELECT id, name, username, role, department, status, created_at, approved_at
      FROM users
      WHERE id = ? AND status = 'approved'
    `);
    const user = userStmt.get(verifiedUserId);
    if (user) {
      // Cache session locally in this container's SQLite instance
      try {
        const expiresAt = new Date(Date.now() + SESSION_TTL_MS).toISOString();
        db.prepare('INSERT OR IGNORE INTO sessions (id, user_id, expires_at) VALUES (?, ?, ?)').run(sessionId, user.id, expiresAt);
      } catch (_) {}
      return user;
    }
  }

  return null;
}

/**
 * Authentication Middleware: enforces valid session
 */
function requireAuth(req, res, next) {
  const token = req.cookies?.session_id || req.headers.authorization?.replace(/^Bearer\s+/i, '');
  
  if (!token) {
    return res.status(401).json({ error: 'Authentication required. Please sign in.' });
  }

  const user = getSessionUser(token);
  if (!user) {
    return res.status(401).json({ error: 'Session expired or invalid. Please sign in again.' });
  }

  if (user.status !== 'approved') {
    return res.status(403).json({ error: 'Account clearance required. Your account is not approved.' });
  }

  req.user = user;
  req.sessionId = token;
  next();
}

/**
 * Admin Role Middleware: enforces role === 'admin'
 */
function requireAdmin(req, res, next) {
  if (!req.user || req.user.role !== 'admin') {
    return res.status(403).json({ error: 'Administrative clearance required for this operation.' });
  }
  next();
}

/**
 * Purge expired sessions from the database
 */
function cleanExpiredSessions() {
  try {
    const now = new Date().toISOString();
    const result = db.prepare('DELETE FROM sessions WHERE expires_at < ?').run(now);
    return Number(result.changes);
  } catch (err) {
    console.error('[Session GC Error]', err);
    return 0;
  }
}

// Automatically clean expired sessions every hour
setInterval(() => {
  cleanExpiredSessions();
}, 60 * 60 * 1000).unref();

module.exports = {
  createSession,
  deleteSession,
  getSessionUser,
  cleanExpiredSessions,
  requireAuth,
  requireAdmin
};
