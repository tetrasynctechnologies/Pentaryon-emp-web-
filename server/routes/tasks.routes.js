const express = require('express');
const { db, syncTurso } = require('../db');
const { requireAuth, requireAdmin } = require('../auth');
const { sanitizeLogText } = require('../security');

const router = express.Router();

router.use(requireAuth);

/**
 * GET /api/tasks
 * Fetch tasks (for employee: their assigned tasks; for admin: all company tasks)
 */
router.get('/', async (req, res) => {
  try {
    try { await syncTurso(); } catch (_) {}
    const { status, priority, assigned_to, search } = req.query;
    const isEmployee = req.user.role !== 'admin';

    let query = `
      SELECT 
        t.id, t.title, t.description, t.priority, t.status, t.progress_percent,
        t.due_date, t.category, t.created_at, t.updated_at,
        u_assignee.id AS assignee_id, u_assignee.name AS assignee_name, u_assignee.username AS assignee_username, u_assignee.department AS assignee_department,
        u_creator.id AS creator_id, u_creator.name AS creator_name
      FROM tasks t
      JOIN users u_assignee ON t.assigned_to = u_assignee.id
      JOIN users u_creator ON t.assigned_by = u_creator.id
      WHERE 1=1
    `;
    const params = [];

    // If employee, restrict strictly to their own tasks
    if (isEmployee) {
      query += ' AND t.assigned_to = ?';
      params.push(req.user.id);
    } else if (assigned_to) {
      query += ' AND t.assigned_to = ?';
      params.push(parseInt(assigned_to, 10));
    }

    if (status) {
      query += ' AND t.status = ?';
      params.push(status);
    }

    if (priority) {
      query += ' AND t.priority = ?';
      params.push(priority);
    }

    if (search && typeof search === 'string') {
      const cleanSearch = search.trim().slice(0, 100);
      if (cleanSearch) {
        const escaped = cleanSearch.replace(/[%_\\]/g, '\\$&');
        query += " AND (t.title LIKE ? ESCAPE '\\' OR t.description LIKE ? ESCAPE '\\')";
        params.push(`%${escaped}%`, `%${escaped}%`);
      }
    }

    query += " ORDER BY CASE t.priority WHEN 'urgent' THEN 1 WHEN 'high' THEN 2 WHEN 'medium' THEN 3 ELSE 4 END, t.updated_at DESC";

    const tasks = db.prepare(query).all(...params);
    return res.json({ tasks });
  } catch (err) {
    console.error('Fetch tasks error:', err);
    return res.status(500).json({ error: 'Failed to retrieve tasks.' });
  }
});

/**
 * POST /api/tasks
 * Create / Assign a new task (Administrators)
 */
router.post('/', requireAdmin, async (req, res) => {
  try {
    const { title, description, priority, assigned_to, due_date, category } = req.body;

    if (!title || typeof title !== 'string' || title.trim().length < 3 || title.trim().length > 200) {
      return res.status(400).json({ error: 'Task title is required (between 3 and 200 characters).' });
    }

    if (!description || typeof description !== 'string' || description.trim().length < 5 || description.trim().length > 5000) {
      return res.status(400).json({ error: 'Detailed task description is required (between 5 and 5000 characters).' });
    }

    // Multi-strategy employee lookup: ID, username, or legacy mapping
    let assignee = null;
    const assigneeId = parseInt(assigned_to, 10);
    if (!isNaN(assigneeId) && assigneeId > 0) {
      assignee = db.prepare("SELECT id, name, username, status, department FROM users WHERE id = ?").get(assigneeId);
    }
    if (!assignee && assigned_to) {
      const cleanUser = String(assigned_to).trim().toLowerCase();
      assignee = db.prepare("SELECT id, name, username, status, department FROM users WHERE LOWER(username) = ?").get(cleanUser);
    }
    if (!assignee && !isNaN(assigneeId)) {
      const legacyMap = { 5: 'prashetha', 6: 'chethana', 9: 'chethana', 7: 'surya', 10: 'surya', 8: 'harish', 11: 'harish' };
      if (legacyMap[assigneeId]) {
        assignee = db.prepare("SELECT id, name, username, status, department FROM users WHERE LOWER(username) = ?").get(legacyMap[assigneeId]);
      }
    }

    if (!assignee) {
      return res.status(404).json({ error: 'Selected employee does not exist.' });
    }
    if (assignee.status !== 'approved') {
      return res.status(400).json({ error: 'Cannot assign work to an employee whose account is not approved.' });
    }

    const validPriorities = ['low', 'medium', 'high', 'urgent'];
    const cleanPriority = validPriorities.includes(priority) ? priority : 'medium';
    const cleanCategory = (category && typeof category === 'string')
      ? sanitizeLogText(category, 100)
      : (assignee.department || 'General');
    const cleanDueDate = (due_date && typeof due_date === 'string') ? due_date.trim().slice(0, 20) : null;

    const insertStmt = db.prepare(`
      INSERT INTO tasks (title, description, priority, status, progress_percent, assigned_to, assigned_by, due_date, category)
      VALUES (?, ?, ?, 'pending', 0, ?, ?, ?, ?)
    `);

    const result = insertStmt.run(
      title.trim(),
      description.trim(),
      cleanPriority,
      assignee.id,
      req.user.id,
      cleanDueDate,
      cleanCategory
    );

    const taskId = Number(result.lastInsertRowid);

    // Initial update log
    db.prepare(`
      INSERT INTO task_updates (task_id, user_id, old_status, new_status, progress_percent, note)
      VALUES (?, ?, 'none', 'pending', 0, ?)
    `).run(taskId, req.user.id, `Task created and assigned to ${assignee.name} (@${assignee.username}) by ${req.user.name}`);

    // Audit log
    db.prepare(`
      INSERT INTO audit_logs (action, actor_id, target_id, details)
      VALUES ('TASK_ASSIGNED', ?, ?, ?)
    `).run(req.user.id, taskId, sanitizeLogText(`Admin ${req.user.username} assigned task "${title.trim()}" to ${assignee.username}`));

    const createdTask = db.prepare(`
      SELECT 
        t.id, t.title, t.description, t.priority, t.status, t.progress_percent,
        t.due_date, t.category, t.created_at, t.updated_at,
        u.name AS assignee_name, u.username AS assignee_username
      FROM tasks t
      JOIN users u ON t.assigned_to = u.id
      WHERE t.id = ?
    `).get(taskId);

    try { syncTurso(true); } catch (_) {}

    return res.status(201).json({
      success: true,
      message: `Work assigned successfully to ${assignee.name}.`,
      task: createdTask
    });
  } catch (err) {
    console.error('Create task error:', err);
    return res.status(500).json({ error: 'Failed to create and assign task.' });
  }
});

/**
 * GET /api/tasks/:id
 * Fetch task details with complete history timeline
 */
router.get('/:id', async (req, res) => {
  try {
    const taskId = parseInt(req.params.id, 10);
    if (isNaN(taskId) || !taskId) {
      return res.status(400).json({ error: 'Invalid task ID.' });
    }

    let task = db.prepare(`
      SELECT 
        t.id, t.title, t.description, t.priority, t.status, t.progress_percent,
        t.due_date, t.category, t.created_at, t.updated_at,
        u_assignee.id AS assignee_id, u_assignee.name AS assignee_name, u_assignee.username AS assignee_username, u_assignee.department AS assignee_department,
        u_creator.id AS creator_id, u_creator.name AS creator_name
      FROM tasks t
      JOIN users u_assignee ON t.assigned_to = u_assignee.id
      JOIN users u_creator ON t.assigned_by = u_creator.id
      WHERE t.id = ?
    `).get(taskId);

    // If not found in local replica, attempt explicit sync from Turso primary
    if (!task) {
      try { await syncTurso(true); } catch (_) {}
      task = db.prepare(`
        SELECT 
          t.id, t.title, t.description, t.priority, t.status, t.progress_percent,
          t.due_date, t.category, t.created_at, t.updated_at,
          u_assignee.id AS assignee_id, u_assignee.name AS assignee_name, u_assignee.username AS assignee_username, u_assignee.department AS assignee_department,
          u_creator.id AS creator_id, u_creator.name AS creator_name
        FROM tasks t
        JOIN users u_assignee ON t.assigned_to = u_assignee.id
        JOIN users u_creator ON t.assigned_by = u_creator.id
        WHERE t.id = ?
      `).get(taskId);
    }

    if (!task) {
      return res.status(404).json({ error: 'Task not found.' });
    }

    // Access check: assignee, creator, or admin can view
    if (req.user.role !== 'admin' && task.assignee_id !== req.user.id && task.creator_id !== req.user.id) {
      return res.status(403).json({ error: 'Access denied. You can only view tasks assigned to you.' });
    }

    // Fetch updates history
    const updates = db.prepare(`
      SELECT 
        tu.id, tu.old_status, tu.new_status, tu.progress_percent, tu.note, tu.created_at,
        u.name AS updater_name, u.role AS updater_role
      FROM task_updates tu
      JOIN users u ON tu.user_id = u.id
      WHERE tu.task_id = ?
      ORDER BY tu.created_at DESC
    `).all(taskId);

    return res.json({ task, updates });
  } catch (err) {
    console.error('Get task details error:', err);
    return res.status(500).json({ error: 'Failed to retrieve task details.' });
  }
});

/**
 * PATCH /api/tasks/:id/progress
 * Update work status, progress percentage, and add milestone notes
 */
router.patch('/:id/progress', async (req, res) => {
  try {
    const taskId = parseInt(req.params.id, 10);
    const { status, progress_percent, note, due_date } = req.body;

    if (isNaN(taskId) || !taskId) {
      return res.status(400).json({ error: 'Invalid task ID.' });
    }

    let task = db.prepare('SELECT * FROM tasks WHERE id = ?').get(taskId);
    if (!task) {
      try { await syncTurso(true); } catch (_) {}
      task = db.prepare('SELECT * FROM tasks WHERE id = ?').get(taskId);
    }

    if (!task) {
      return res.status(404).json({ error: 'Task not found.' });
    }

    // Permissions: Assignee, Assigner, or Admin
    if (req.user.role !== 'admin' && task.assigned_to !== req.user.id && task.assigned_by !== req.user.id) {
      return res.status(403).json({ error: 'You are only authorized to update tasks assigned to you or created by you.' });
    }

    if (!note || typeof note !== 'string' || note.trim().length < 3 || note.trim().length > 1000) {
      return res.status(400).json({ error: 'Please enter a progress update note (between 3 and 1000 characters).' });
    }

    const validStatuses = ['pending', 'in_progress', 'review', 'completed'];
    let newStatus = (status && validStatuses.includes(status)) ? status : task.status;

    let newProgress = task.progress_percent;
    if (progress_percent !== undefined && progress_percent !== null) {
      const parsed = parseInt(progress_percent, 10);
      if (isNaN(parsed) || parsed < 0 || parsed > 100) {
        return res.status(400).json({ error: 'Progress percentage must be an integer between 0 and 100.' });
      }
      newProgress = parsed;
    }

    // Auto-sync status and progress
    if (newStatus === 'completed' && newProgress < 100) {
      newProgress = 100;
    } else if (newProgress === 100 && newStatus !== 'completed') {
      newStatus = 'completed';
    } else if (newProgress > 0 && newStatus === 'pending') {
      newStatus = 'in_progress';
    }

    // Due date update (Admin only)
    let newDueDate = task.due_date;
    let dueChanged = false;
    if (due_date !== undefined && due_date !== null && due_date !== '') {
      if (req.user.role !== 'admin') {
        return res.status(403).json({ error: 'Only administrators are authorized to update task due dates.' });
      }
      const cleanDue = (typeof due_date === 'string') ? due_date.trim().slice(0, 20) : null;
      if (cleanDue && cleanDue !== task.due_date) {
        newDueDate = cleanDue;
        dueChanged = true;
      }
    }

    // Update task
    db.prepare(`
      UPDATE tasks
      SET status = ?, progress_percent = ?, due_date = ?, updated_at = CURRENT_TIMESTAMP
      WHERE id = ?
    `).run(newStatus, newProgress, newDueDate, taskId);

    // Insert update history log
    const noteWithDue = dueChanged
      ? `${note.trim()} (Due date updated to ${newDueDate})`
      : note.trim();

    db.prepare(`
      INSERT INTO task_updates (task_id, user_id, old_status, new_status, progress_percent, note)
      VALUES (?, ?, ?, ?, ?, ?)
    `).run(taskId, req.user.id, task.status, newStatus, newProgress, noteWithDue);

    // Audit log
    db.prepare(`
      INSERT INTO audit_logs (action, actor_id, target_id, details)
      VALUES ('TASK_UPDATED', ?, ?, ?)
    `).run(
      req.user.id,
      taskId,
      sanitizeLogText(`User ${req.user.username} updated task #${taskId}: status=${newStatus}, progress=${newProgress}%${dueChanged ? `, due_date=${newDueDate}` : ''}`)
    );

    return res.json({
      success: true,
      message: 'Work progress updated successfully!',
      task: {
        id: taskId,
        status: newStatus,
        progress_percent: newProgress,
        due_date: newDueDate
      }
    });
  } catch (err) {
    console.error('Update progress error:', err);
    return res.status(500).json({ error: 'Failed to update work progress.' });
  }
});

/**
 * DELETE /api/tasks/:id
 * Delete task (Admin only)
 */
router.delete('/:id', requireAdmin, async (req, res) => {
  try {
    const taskId = parseInt(req.params.id, 10);
    if (isNaN(taskId) || !taskId) {
      return res.status(400).json({ error: 'Invalid task ID.' });
    }

    let task = db.prepare('SELECT id, title FROM tasks WHERE id = ?').get(taskId);
    if (!task) {
      try { await syncTurso(true); } catch (_) {}
      task = db.prepare('SELECT id, title FROM tasks WHERE id = ?').get(taskId);
    }

    if (!task) {
      return res.status(404).json({ error: 'Task not found.' });
    }

    db.prepare('DELETE FROM tasks WHERE id = ?').run(taskId);

    db.prepare(`
      INSERT INTO audit_logs (action, actor_id, target_id, details)
      VALUES ('TASK_DELETED', ?, ?, ?)
    `).run(req.user.id, taskId, sanitizeLogText(`Admin ${req.user.username} deleted task #${taskId} ("${task.title}")`));

    return res.json({ success: true, message: 'Task deleted successfully.' });
  } catch (err) {
    console.error('Delete task error:', err);
    return res.status(500).json({ error: 'Failed to delete task.' });
  }
});

module.exports = router;
