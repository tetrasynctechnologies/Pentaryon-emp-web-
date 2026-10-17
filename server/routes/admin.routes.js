const express = require('express');
const { db } = require('../db');
const { requireAuth, requireAdmin } = require('../auth');
const { sanitizeLogText } = require('../security');

const router = express.Router();

// Apply auth and admin enforcement to all admin routes
router.use(requireAuth, requireAdmin);

/**
 * GET /api/admin/requests
 * Fetch all pending employee registration requests
 */
router.get('/requests', (req, res) => {
  try {
    const requests = db.prepare(`
      SELECT id, name, username, department, status, notes, created_at
      FROM users
      WHERE status = 'pending'
      ORDER BY created_at DESC
    `).all();

    return res.json({ requests });
  } catch (err) {
    console.error('Fetch requests error:', err);
    return res.status(500).json({ error: 'Failed to retrieve pending employee requests.' });
  }
});

/**
 * POST /api/admin/requests/:id/approve
 * Approve employee account request
 */
router.post('/requests/:id/approve', (req, res) => {
  try {
    const userId = parseInt(req.params.id, 10);
    if (!userId) {
      return res.status(400).json({ error: 'Invalid user ID.' });
    }

    const user = db.prepare('SELECT id, name, username, status FROM users WHERE id = ?').get(userId);
    if (!user) {
      return res.status(404).json({ error: 'User registration request not found.' });
    }

    if (user.status === 'approved') {
      return res.status(400).json({ error: 'This user account is already approved.' });
    }

    db.prepare(`
      UPDATE users
      SET status = 'approved', approved_at = CURRENT_TIMESTAMP, approved_by = ?, rejection_reason = NULL
      WHERE id = ?
    `).run(req.user.id, userId);

    // Audit log
    db.prepare(`
      INSERT INTO audit_logs (action, actor_id, target_id, details)
      VALUES ('REGISTRATION_APPROVED', ?, ?, ?)
    `).run(req.user.id, userId, sanitizeLogText(`Admin ${req.user.username} approved account for ${user.username} (${user.name})`));

    return res.json({
      success: true,
      message: `Account for ${user.name} (@${user.username}) has been approved. The employee can now sign in.`
    });
  } catch (err) {
    console.error('Approve request error:', err);
    return res.status(500).json({ error: 'Failed to approve employee registration request.' });
  }
});

/**
 * POST /api/admin/requests/:id/reject
 * Reject employee account request
 */
router.post('/requests/:id/reject', (req, res) => {
  try {
    const userId = parseInt(req.params.id, 10);
    const { reason } = req.body;
    if (!userId) {
      return res.status(400).json({ error: 'Invalid user ID.' });
    }

    const user = db.prepare('SELECT id, name, username, status FROM users WHERE id = ?').get(userId);
    if (!user) {
      return res.status(404).json({ error: 'User registration request not found.' });
    }

    const cleanReason = (reason && typeof reason === 'string')
      ? sanitizeLogText(reason, 300)
      : 'Application did not meet administrative requirements.';

    db.prepare(`
      UPDATE users
      SET status = 'rejected', rejection_reason = ?, approved_at = NULL, approved_by = ?
      WHERE id = ?
    `).run(cleanReason, req.user.id, userId);

    // Audit log
    db.prepare(`
      INSERT INTO audit_logs (action, actor_id, target_id, details)
      VALUES ('REGISTRATION_REJECTED', ?, ?, ?)
    `).run(req.user.id, userId, sanitizeLogText(`Admin ${req.user.username} rejected account for ${user.username}. Reason: ${cleanReason}`));

    return res.json({
      success: true,
      message: `Registration request for ${user.name} (@${user.username}) has been rejected.`
    });
  } catch (err) {
    console.error('Reject request error:', err);
    return res.status(500).json({ error: 'Failed to reject employee registration request.' });
  }
});

/**
 * DELETE /api/admin/requests/:id
 * Permanently purge a pending or rejected account request (Administrators)
 */
router.delete('/requests/:id', (req, res) => {
  try {
    const userId = parseInt(req.params.id, 10);
    if (!userId) {
      return res.status(400).json({ error: 'Invalid user ID.' });
    }

    const user = db.prepare('SELECT id, name, username, status FROM users WHERE id = ?').get(userId);
    if (!user) {
      return res.status(404).json({ error: 'User registration request not found.' });
    }

    if (user.status === 'approved') {
      return res.status(400).json({ error: 'Cannot delete an active, approved user account via this endpoint.' });
    }

    db.prepare('DELETE FROM users WHERE id = ?').run(userId);

    db.prepare(`
      INSERT INTO audit_logs (action, actor_id, details)
      VALUES ('REGISTRATION_PURGED', ?, ?)
    `).run(req.user.id, sanitizeLogText(`Admin ${req.user.username} purged request for ${user.username} (${user.name})`));

    return res.json({
      success: true,
      message: `Account request for ${user.name} (@${user.username}) has been permanently dismissed.`
    });
  } catch (err) {
    console.error('Delete request error:', err);
    return res.status(500).json({ error: 'Failed to delete registration request.' });
  }
});

/**
 * GET /api/admin/employees
 * List all active/approved employees with task statistics
 */
router.get('/employees', (req, res) => {
  try {
    const employees = db.prepare(`
      SELECT 
        u.id, 
        u.name, 
        u.username, 
        u.department, 
        u.status, 
        u.created_at, 
        u.last_login_at,
        COUNT(t.id) AS total_tasks,
        SUM(CASE WHEN t.status = 'completed' THEN 1 ELSE 0 END) AS completed_tasks,
        SUM(CASE WHEN t.status IN ('in_progress', 'review') THEN 1 ELSE 0 END) AS active_tasks
      FROM users u
      LEFT JOIN tasks t ON u.id = t.assigned_to
      WHERE u.role = 'employee' AND u.status = 'approved'
      GROUP BY u.id
      ORDER BY u.name ASC
    `).all();

    return res.json({ employees });
  } catch (err) {
    console.error('Fetch employees error:', err);
    return res.status(500).json({ error: 'Failed to retrieve employees directory.' });
  }
});

/**
 * DELETE /api/admin/employees/:id
 * Permanently remove an employee account and associated records (Administrators)
 */
router.delete('/employees/:id', (req, res) => {
  try {
    const userId = parseInt(req.params.id, 10);
    if (!userId) {
      return res.status(400).json({ error: 'Invalid employee ID.' });
    }

    if (userId === req.user.id) {
      return res.status(400).json({ error: 'You cannot delete your own account.' });
    }

    const employee = db.prepare('SELECT id, name, username, role FROM users WHERE id = ?').get(userId);
    if (!employee) {
      return res.status(404).json({ error: 'Employee not found.' });
    }

    if (employee.role === 'admin') {
      return res.status(403).json({ error: 'Administrator accounts cannot be deleted via this endpoint.' });
    }

    // Clean up associated updates for tasks assigned to this user, then user updates, tasks, sessions, and user record
    db.prepare('DELETE FROM task_updates WHERE task_id IN (SELECT id FROM tasks WHERE assigned_to = ?)').run(userId);
    db.prepare('DELETE FROM task_updates WHERE user_id = ?').run(userId);
    db.prepare('DELETE FROM tasks WHERE assigned_to = ?').run(userId);
    db.prepare('DELETE FROM sessions WHERE user_id = ?').run(userId);
    db.prepare('DELETE FROM users WHERE id = ?').run(userId);

    // Audit log
    db.prepare(`
      INSERT INTO audit_logs (action, actor_id, details)
      VALUES ('EMPLOYEE_DELETED', ?, ?)
    `).run(req.user.id, sanitizeLogText(`Admin ${req.user.username} deleted employee account ${employee.username} (${employee.name})`));

    return res.json({
      success: true,
      message: `Employee ${employee.name} (@${employee.username}) has been successfully deleted.`
    });
  } catch (err) {
    console.error('Delete employee error:', err);
    return res.status(500).json({ error: 'Failed to delete employee account.' });
  }
});

/**
 * PATCH /api/admin/employees/:id
 * Update an employee's details such as Name or Department / Role (Administrators)
 */
router.patch('/employees/:id', (req, res) => {
  try {
    const userId = parseInt(req.params.id, 10);
    const { name, department } = req.body;

    if (!userId) {
      return res.status(400).json({ error: 'Invalid employee ID.' });
    }

    const employee = db.prepare('SELECT id, name, username, role, department FROM users WHERE id = ?').get(userId);
    if (!employee) {
      return res.status(404).json({ error: 'Employee not found.' });
    }

    if (employee.role === 'admin') {
      return res.status(403).json({ error: 'Cannot modify administrator accounts via this endpoint.' });
    }

    const updates = [];
    const params = [];

    if (name && typeof name === 'string' && name.trim()) {
      const cleanName = sanitizeLogText(name, 100);
      updates.push('name = ?');
      params.push(cleanName);
    }

    if (department && typeof department === 'string' && department.trim()) {
      const cleanDept = sanitizeLogText(department, 100);
      updates.push('department = ?');
      params.push(cleanDept);
    }

    if (updates.length === 0) {
      return res.status(400).json({ error: 'No fields provided for update.' });
    }

    params.push(userId);
    db.prepare(`UPDATE users SET ${updates.join(', ')} WHERE id = ?`).run(...params);

    // Audit log
    db.prepare(`
      INSERT INTO audit_logs (action, actor_id, target_id, details)
      VALUES ('EMPLOYEE_UPDATED', ?, ?, ?)
    `).run(
      req.user.id,
      userId,
      sanitizeLogText(`Admin ${req.user.username} updated employee @${employee.username}: ${updates.join(', ')}`)
    );

    return res.json({
      success: true,
      message: `Employee @${employee.username} updated successfully.`
    });
  } catch (err) {
    console.error('Update employee error:', err);
    return res.status(500).json({ error: 'Failed to update employee details.' });
  }
});

/**
 * POST /api/admin/employees
 * Directly provision a new approved employee account (Administrators)
 */
router.post('/employees', (req, res) => {
  try {
    const { name, username, password, department } = req.body;
    if (!name || typeof name !== 'string' || name.trim().length < 2 || name.trim().length > 100) {
      return res.status(400).json({ error: 'Full name is required (between 2 and 100 characters).' });
    }
    if (!username || typeof username !== 'string') {
      return res.status(400).json({ error: 'A valid username is required.' });
    }
    const cleanUsername = username.trim().toLowerCase();
    if (!/^[a-z0-9_.-]{3,30}$/.test(cleanUsername)) {
      return res.status(400).json({ error: 'Username must be 3-30 characters (letters, numbers, dots, hyphens, underscores).' });
    }
    if (!password || typeof password !== 'string' || password.length < 8 || password.length > 128) {
      return res.status(400).json({ error: 'Password must be between 8 and 128 characters.' });
    }
    const cleanDept = (department && typeof department === 'string') ? sanitizeLogText(department, 100) : 'General';
    const cleanName = sanitizeLogText(name, 100);

    const existing = db.prepare('SELECT id FROM users WHERE username = ?').get(cleanUsername);
    if (existing) {
      return res.status(409).json({ error: 'Username already taken. Please choose another username.' });
    }

    const { hashPassword } = require('../db');
    const { hash, salt } = hashPassword(password);
    const result = db.prepare(`
      INSERT INTO users (name, username, password_hash, salt, role, department, status, approved_at, approved_by)
      VALUES (?, ?, ?, ?, 'employee', ?, 'approved', CURRENT_TIMESTAMP, ?)
    `).run(cleanName, cleanUsername, hash, salt, cleanDept, req.user.id);

    const newId = Number(result.lastInsertRowid);
    db.prepare(`
      INSERT INTO audit_logs (action, actor_id, target_id, details)
      VALUES ('EMPLOYEE_CREATED', ?, ?, ?)
    `).run(req.user.id, newId, sanitizeLogText(`Admin ${req.user.username} created employee ${cleanUsername} (${cleanName})`));

    return res.status(201).json({
      success: true,
      message: `Employee ${name.trim()} (@${cleanUsername}) created successfully.`,
      employee: { id: newId, name: name.trim(), username: cleanUsername, department: cleanDept }
    });
  } catch (err) {
    console.error('Create employee error:', err);
    return res.status(500).json({ error: 'Failed to create employee account.' });
  }
});

/**
 * GET /api/admin/stats
 * Aggregate dashboard statistics
 */
router.get('/stats', (req, res) => {
  try {
    const pendingReqs = db.prepare("SELECT COUNT(*) AS count FROM users WHERE status = 'pending'").get().count;
    const activeEmps = db.prepare("SELECT COUNT(*) AS count FROM users WHERE role = 'employee' AND status = 'approved'").get().count;
    const totalTasks = db.prepare('SELECT COUNT(*) AS count FROM tasks').get().count;
    const completedTasks = db.prepare("SELECT COUNT(*) AS count FROM tasks WHERE status = 'completed'").get().count;
    const inProgressTasks = db.prepare("SELECT COUNT(*) AS count FROM tasks WHERE status = 'in_progress'").get().count;
    const reviewTasks = db.prepare("SELECT COUNT(*) AS count FROM tasks WHERE status = 'review'").get().count;

    return res.json({
      stats: {
        pendingRequests: pendingReqs,
        activeEmployees: activeEmps,
        totalTasks,
        completedTasks,
        inProgressTasks,
        reviewTasks
      }
    });
  } catch (err) {
    console.error('Fetch stats error:', err);
    return res.status(500).json({ error: 'Failed to load administrator statistics.' });
  }
});

/**
 * GET /api/admin/audit-logs
 * Audit history
 */
router.get('/audit-logs', (req, res) => {
  try {
    const logs = db.prepare(`
      SELECT id, action, actor_id, target_id, details, created_at
      FROM audit_logs
      ORDER BY created_at DESC
      LIMIT 50
    `).all();

    return res.json({ logs });
  } catch (err) {
    console.error('Fetch audit logs error:', err);
    return res.status(500).json({ error: 'Failed to retrieve audit log.' });
  }
});

module.exports = router;
