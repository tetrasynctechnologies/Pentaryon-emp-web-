const express = require('express');
const { db, hashPassword, verifyPassword } = require('../db');
const { createSession, deleteSession, requireAuth } = require('../auth');
const {
  loginRateLimiter,
  recordFailedLogin,
  recordSuccessfulLogin,
  registerRateLimiter,
  dummyVerifyPassword,
  sanitizeLogText
} = require('../security');

const router = express.Router();

/**
 * POST /api/auth/register
 * Employee Account Registration Request (Starts in 'pending' status)
 */
router.post('/register', registerRateLimiter, (req, res) => {
  try {
    const { name, username, password, department, notes } = req.body;

    if (!name || typeof name !== 'string' || name.trim().length < 2 || name.trim().length > 100) {
      return res.status(400).json({ error: 'Please enter your full name (between 2 and 100 characters).' });
    }

    if (!username || typeof username !== 'string') {
      return res.status(400).json({ error: 'A valid username is required.' });
    }

    const cleanUsername = username.trim().toLowerCase();
    if (!/^[a-z0-9_.-]{3,30}$/.test(cleanUsername)) {
      return res.status(400).json({
        error: 'Username must be between 3 and 30 characters and contain only letters, numbers, dots, hyphens, or underscores.'
      });
    }

    if (!password || typeof password !== 'string' || password.length < 8 || password.length > 128) {
      return res.status(400).json({ error: 'Password must be between 8 and 128 characters in length.' });
    }

    if (department && typeof department === 'string' && department.trim().length > 100) {
      return res.status(400).json({ error: 'Department name cannot exceed 100 characters.' });
    }

    if (notes && typeof notes === 'string' && notes.trim().length > 500) {
      return res.status(400).json({ error: 'Notes cannot exceed 500 characters.' });
    }

    // Check if username already exists
    const existing = db.prepare('SELECT id, status FROM users WHERE username = ?').get(cleanUsername);
    if (existing) {
      if (existing.status === 'pending') {
        return res.status(409).json({
          error: 'An account request for this username has already been submitted and is awaiting administrator clearance.'
        });
      }
      return res.status(409).json({ error: 'This username is already taken. Please choose another username.' });
    }

    const cleanDept = (department && typeof department === 'string') ? department.trim() : 'General';
    const cleanNotes = (notes && typeof notes === 'string') ? notes.trim() : null;

    const { hash, salt } = hashPassword(password);

    const insertStmt = db.prepare(`
      INSERT INTO users (name, username, password_hash, salt, role, department, status, notes)
      VALUES (?, ?, ?, ?, 'employee', ?, 'pending', ?)
    `);

    const result = insertStmt.run(name.trim(), cleanUsername, hash, salt, cleanDept, cleanNotes);
    const newUserId = Number(result.lastInsertRowid);

    // Audit log
    db.prepare(`
      INSERT INTO audit_logs (action, target_id, details)
      VALUES ('REGISTRATION_REQUEST_SUBMITTED', ?, ?)
    `).run(newUserId, sanitizeLogText(`User ${cleanUsername} (${name.trim()}) requested employee account for role: ${cleanDept}`));

    return res.status(201).json({
      success: true,
      status: 'pending',
      message: 'Account request submitted successfully! An administrator will review and approve your account shortly.'
    });
  } catch (err) {
    console.error('Registration error:', err);
    return res.status(500).json({ error: 'Internal server error while processing registration request.' });
  }
});

/**
 * POST /api/auth/login
 * Unified Login for Employees and Administrators
 */
router.post('/login', loginRateLimiter, (req, res) => {
  try {
    const { username, password, expected_role } = req.body;

    if (!username || !password || typeof username !== 'string' || typeof password !== 'string') {
      recordFailedLogin(req, username);
      return res.status(400).json({ error: 'Please enter both username and password.' });
    }

    if (password.length > 128) {
      recordFailedLogin(req, username);
      return res.status(400).json({ error: 'Password exceeds maximum length limit.' });
    }

    const cleanUsername = username.trim().toLowerCase();
    const user = db.prepare(`
      SELECT id, name, username, password_hash, salt, role, department, status, rejection_reason
      FROM users
      WHERE username = ?
    `).get(cleanUsername);

    // Constant-time mitigation against timing enumeration attacks
    if (!user) {
      dummyVerifyPassword(password);
      recordFailedLogin(req, cleanUsername);
      return res.status(401).json({ error: 'Invalid username or password.' });
    }

    if (!verifyPassword(password, user.password_hash, user.salt)) {
      recordFailedLogin(req, cleanUsername);
      return res.status(401).json({ error: 'Invalid username or password.' });
    }

    // Check Account Status
    if (user.status === 'pending') {
      return res.status(403).json({
        error: 'Your account is currently pending administrator clearance. Please contact an executive administrator or wait for approval.',
        status: 'pending'
      });
    }

    if (user.status === 'rejected') {
      const reasonMsg = user.rejection_reason ? ` Reason: "${user.rejection_reason}"` : '';
      return res.status(403).json({
        error: `Your account registration request was rejected by administration.${reasonMsg}`,
        status: 'rejected'
      });
    }

    if (user.status === 'suspended') {
      return res.status(403).json({
        error: 'Your account access has been suspended. Please contact company management.',
        status: 'suspended'
      });
    }

    // Role Separation Gate: ensure admins cannot log in via Employee Access, and employees cannot log in via Executive Admin
    if (expected_role && typeof expected_role === 'string') {
      const cleanExpected = expected_role.trim().toLowerCase();
      if ((cleanExpected === 'employee' || cleanExpected === 'emp') && user.role === 'admin') {
        return res.status(403).json({
          error: 'Administrative accounts cannot authenticate under Employee Access. Please switch to the Executive Admin tab.'
        });
      }
      if ((cleanExpected === 'admin' || cleanExpected === 'adm') && user.role !== 'admin') {
        return res.status(403).json({
          error: 'This account does not have Executive Administrator clearance. Please switch to the Employee Access tab.'
        });
      }
    }

    // Successful authentication: reset failed attempts
    recordSuccessfulLogin(req, cleanUsername);

    // Session Fixation Mitigation: Revoke any previous active session attached to the caller
    const existingSessionId = req.cookies?.session_id;
    if (existingSessionId) {
      deleteSession(existingSessionId);
    }

    // Update last login
    db.prepare('UPDATE users SET last_login_at = CURRENT_TIMESTAMP WHERE id = ?').run(user.id);

    // Create session
    const { sessionId, expiresAt } = createSession(user.id);

    // Set secure HttpOnly cookie with explicit root path
    res.cookie('session_id', sessionId, {
      httpOnly: true,
      sameSite: 'lax',
      secure: req.secure || false,
      path: '/',
      maxAge: 7 * 24 * 60 * 60 * 1000
    });

    // Audit log
    db.prepare(`
      INSERT INTO audit_logs (action, actor_id, details)
      VALUES ('USER_LOGIN_SUCCESS', ?, ?)
    `).run(user.id, sanitizeLogText(`User ${user.username} (${user.role}) logged in`));

    return res.json({
      success: true,
      token: sessionId,
      expiresAt,
      user: {
        id: user.id,
        name: user.name,
        username: user.username,
        role: user.role,
        department: user.department
      }
    });
  } catch (err) {
    console.error('Login error:', err);
    return res.status(500).json({ error: 'Internal server error while processing authentication.' });
  }
});

/**
 * GET /api/auth/me
 * Retrieve current authenticated session
 */
router.get('/me', requireAuth, (req, res) => {
  return res.json({
    user: req.user
  });
});

/**
 * POST /api/auth/logout
 * Invalidate session
 */
router.post('/logout', (req, res) => {
  const token = req.cookies?.session_id || req.headers.authorization?.replace(/^Bearer\s+/i, '');
  if (token) {
    deleteSession(token);
  }
  res.clearCookie('session_id', {
    httpOnly: true,
    sameSite: 'lax',
    secure: req.secure || false,
    path: '/'
  });
  return res.json({ success: true, message: 'Logged out successfully.' });
});

module.exports = router;
