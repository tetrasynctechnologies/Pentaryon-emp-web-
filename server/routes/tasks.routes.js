const express = require('express');
const path = require('node:path');
const { db, turso, syncTurso, flushTurso } = require('../db');
const { requireAuth, requireAdmin } = require('../auth');
const { sanitizeLogText } = require('../security');
const { sendTaskAssignedEmail, sendTaskCompletedEmail } = require('../email.service');
const config = require('../config');

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
      assignee = db.prepare("SELECT id, name, username, email, status, department FROM users WHERE id = ?").get(assigneeId);
    }
    if (!assignee && assigned_to) {
      const cleanUser = String(assigned_to).trim().toLowerCase();
      assignee = db.prepare("SELECT id, name, username, email, status, department FROM users WHERE LOWER(username) = ?").get(cleanUser);
    }
    if (!assignee && !isNaN(assigneeId)) {
      const legacyMap = { 5: 'prashetha', 6: 'chethana', 9: 'chethana', 7: 'surya', 10: 'surya', 8: 'bhuvanika', 11: 'harish' };
      if (legacyMap[assigneeId]) {
        assignee = db.prepare("SELECT id, name, username, email, status, department FROM users WHERE LOWER(username) = ?").get(legacyMap[assigneeId]);
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

    // Guarantee ID consistency between local replica and Turso cloud primary
    let nextTaskId = null;
    if (turso) {
      try {
        const maxRes = await turso.execute('SELECT MAX(id) AS max_id FROM tasks');
        const maxRemote = maxRes.rows[0]?.max_id ? Number(maxRes.rows[0].max_id) : 0;
        const maxLocal = db.prepare('SELECT MAX(id) AS max_id FROM tasks').get()?.max_id || 0;
        nextTaskId = Math.max(maxRemote, maxLocal) + 1;
      } catch (_) {}
    }
    if (!nextTaskId) {
      const maxLocal = db.prepare('SELECT MAX(id) AS max_id FROM tasks').get()?.max_id || 0;
      nextTaskId = maxLocal + 1;
    }

    const insertStmt = db.prepare(`
      INSERT INTO tasks (id, title, description, priority, status, progress_percent, assigned_to, assigned_by, due_date, category)
      VALUES (?, ?, ?, ?, 'pending', 0, ?, ?, ?, ?)
    `);

    insertStmt.run(
      nextTaskId,
      title.trim(),
      description.trim(),
      cleanPriority,
      assignee.id,
      req.user.id,
      cleanDueDate,
      cleanCategory
    );

    const taskId = nextTaskId;

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

    // Automated Gmail Notification Dispatch
    try {
      const emailResult = await sendTaskAssignedEmail({
        task: {
          id: taskId,
          title: title.trim(),
          description: description.trim(),
          priority: cleanPriority,
          category: cleanCategory,
          due_date: cleanDueDate
        },
        assignee,
        creator: req.user
      });

      if (emailResult.success) {
        db.prepare(`
          INSERT INTO audit_logs (action, actor_id, target_id, details)
          VALUES ('TASK_EMAIL_DISPATCHED', ?, ?, ?)
        `).run(req.user.id, taskId, sanitizeLogText(`Dispatched official task briefing email to ${assignee.email} from tetrasynctech@gmail.com`));
      }
    } catch (mailErr) {
      console.warn('[Task Email Dispatch Warning]', mailErr.message);
    }

    // Flush writes to Turso before returning in serverless
    try { await flushTurso(); } catch (_) {}

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

    // Fetch attachments metadata
    let attachments = [];
    try {
      attachments = db.prepare(`
        SELECT 
          ta.id, ta.task_id, ta.user_id, ta.filename, ta.file_type, ta.file_size, ta.created_at,
          u.name AS uploader_name, u.username AS uploader_username
        FROM task_attachments ta
        JOIN users u ON ta.user_id = u.id
        WHERE ta.task_id = ?
        ORDER BY ta.created_at DESC
      `).all(taskId);
    } catch (_) {}

    return res.json({ task, updates, attachments });
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

    // Check if task is transitioning to 100% completed
    const wasCompleted = task.status === 'completed' || Number(task.progress_percent) === 100;
    const isNowCompleted = newStatus === 'completed' || Number(newProgress) === 100;

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

    // Milestone Completion Email Notification (Option B: Delegating Executive + CC to Executive Leadership)
    if (isNowCompleted && !wasCompleted) {
      const assignee = db.prepare('SELECT id, name, username, email, department FROM users WHERE id = ?').get(task.assigned_to);
      const creator = db.prepare('SELECT id, name, username, email FROM users WHERE id = ?').get(task.assigned_by);

      sendTaskCompletedEmail({
        task: {
          id: taskId,
          title: task.title,
          priority: task.priority,
          category: task.category,
          due_date: newDueDate
        },
        assignee: assignee || req.user,
        creator: creator || { name: 'Executive Admin', email: config.admins[0]?.email },
        milestoneNote: noteWithDue
      }).then((emailRes) => {
        if (emailRes && emailRes.success) {
          try {
            db.prepare(`
              INSERT INTO audit_logs (action, actor_id, target_id, details)
              VALUES ('TASK_COMPLETION_EMAIL_DISPATCHED', ?, ?, ?)
            `).run(req.user.id, taskId, sanitizeLogText(`Dispatched 100% completion briefing email for task #${taskId}`));
          } catch (_) {}
        }
      }).catch((mailErr) => {
        console.warn('[Task Completion Email Warning]', mailErr.message);
      });
    }

    // Flush pending Turso writes before serverless response freeze
    try { await flushTurso(); } catch (_) {}

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

    // Direct deletion on Turso cloud to ensure atomic deletion across distributed replicas
    if (turso) {
      try {
        await turso.execute({ sql: 'DELETE FROM task_updates WHERE task_id = ?', args: [taskId] });
        await turso.execute({ sql: 'DELETE FROM task_attachments WHERE task_id = ?', args: [taskId] });
        await turso.execute({ sql: 'DELETE FROM tasks WHERE id = ?', args: [taskId] });
      } catch (tErr) {
        console.warn('[Turso Direct Delete Error]', tErr.message);
      }
    }

    // Explicitly delete task updates and attachments first locally to maintain foreign key integrity
    db.prepare('DELETE FROM task_updates WHERE task_id = ?').run(taskId);
    db.prepare('DELETE FROM task_attachments WHERE task_id = ?').run(taskId);
    db.prepare('DELETE FROM tasks WHERE id = ?').run(taskId);

    if (task) {
      db.prepare(`
        INSERT INTO audit_logs (action, actor_id, target_id, details)
        VALUES ('TASK_DELETED', ?, ?, ?)
      `).run(req.user.id, taskId, sanitizeLogText(`Admin ${req.user.username} deleted task #${taskId} ("${task.title}")`));
    }

    // Flush pending Turso writes before serverless response freeze
    try { await flushTurso(); } catch (_) {}

    return res.json({
      success: true,
      message: `Task #${taskId} deleted successfully.`
    });
  } catch (err) {
    console.error('Delete task error:', err);
    return res.status(500).json({ error: 'Failed to delete task.' });
  }
});

/**
 * POST /api/tasks/:id/attachments
 * Upload a file / asset deliverable for a task (Assignee, Assigner, or Admin)
 */
router.post('/:id/attachments', async (req, res) => {
  try {
    const taskId = parseInt(req.params.id, 10);
    if (isNaN(taskId) || !taskId) {
      return res.status(400).json({ error: 'Invalid task ID.' });
    }

    let task = db.prepare('SELECT id, assigned_to, assigned_by FROM tasks WHERE id = ?').get(taskId);
    if (!task) {
      try { await syncTurso(true); } catch (_) {}
      task = db.prepare('SELECT id, assigned_to, assigned_by FROM tasks WHERE id = ?').get(taskId);
    }
    if (!task) {
      return res.status(404).json({ error: 'Task not found.' });
    }

    // Access check: Assignee, creator, or admin
    if (req.user.role !== 'admin' && task.assigned_to !== req.user.id && task.assigned_by !== req.user.id) {
      return res.status(403).json({ error: 'You are only authorized to upload attachments to tasks assigned to you or created by you.' });
    }

    const { filename, file_type, file_data } = req.body;
    if (!filename || typeof filename !== 'string' || filename.trim().length === 0) {
      return res.status(400).json({ error: 'Attachment filename is required.' });
    }
    if (!file_data || typeof file_data !== 'string') {
      return res.status(400).json({ error: 'Attachment file content is required.' });
    }

    // Sanitize filename: extract basename and limit length
    const cleanFilename = path.basename(filename.trim()).slice(0, 200);
    const cleanFileType = (file_type && typeof file_type === 'string')
      ? file_type.trim().slice(0, 100).toLowerCase()
      : 'application/octet-stream';

    // Strip data URI header if provided
    const base64Content = file_data.replace(/^data:[^;]+;base64,/, '');

    // Approximate size from base64 string
    const fileSize = Math.round((base64Content.length * 3) / 4);

    // Limit file size to 5MB (5 * 1024 * 1024 bytes)
    const MAX_FILE_SIZE = 5 * 1024 * 1024;
    if (fileSize > MAX_FILE_SIZE) {
      return res.status(400).json({ error: 'File size exceeds maximum allowed limit of 5MB.' });
    }

    const insertStmt = db.prepare(`
      INSERT INTO task_attachments (task_id, user_id, filename, file_type, file_size, file_data)
      VALUES (?, ?, ?, ?, ?, ?)
    `);

    const result = insertStmt.run(taskId, req.user.id, cleanFilename, cleanFileType, fileSize, base64Content);
    const attachmentId = Number(result.lastInsertRowid);

    // Audit log
    db.prepare(`
      INSERT INTO audit_logs (action, actor_id, target_id, details)
      VALUES ('TASK_ATTACHMENT_UPLOADED', ?, ?, ?)
    `).run(req.user.id, taskId, sanitizeLogText(`User ${req.user.username} uploaded attachment "${cleanFilename}" (${Math.round(fileSize / 1024)} KB) to task #${taskId}`));

    // Flush to Turso cloud
    try { await flushTurso(); } catch (_) {}

    return res.status(201).json({
      success: true,
      message: 'Attachment uploaded successfully.',
      attachment: {
        id: attachmentId,
        task_id: taskId,
        filename: cleanFilename,
        file_type: cleanFileType,
        file_size: fileSize,
        created_at: new Date().toISOString(),
        uploader_name: req.user.name,
        uploader_username: req.user.username
      }
    });
  } catch (err) {
    console.error('Upload attachment error:', err);
    return res.status(500).json({ error: 'Failed to upload attachment.' });
  }
});

/**
 * GET /api/tasks/:id/attachments
 * List all attachments for a task (without heavy file_data payload)
 */
router.get('/:id/attachments', async (req, res) => {
  try {
    const taskId = parseInt(req.params.id, 10);
    if (isNaN(taskId) || !taskId) {
      return res.status(400).json({ error: 'Invalid task ID.' });
    }

    let task = db.prepare('SELECT id, assigned_to, assigned_by FROM tasks WHERE id = ?').get(taskId);
    if (!task) {
      try { await syncTurso(true); } catch (_) {}
      task = db.prepare('SELECT id, assigned_to, assigned_by FROM tasks WHERE id = ?').get(taskId);
    }
    if (!task) {
      return res.status(404).json({ error: 'Task not found.' });
    }

    if (req.user.role !== 'admin' && task.assigned_to !== req.user.id && task.assigned_by !== req.user.id) {
      return res.status(403).json({ error: 'Access denied. You can only view attachments on tasks assigned to you.' });
    }

    const attachments = db.prepare(`
      SELECT 
        ta.id, ta.task_id, ta.user_id, ta.filename, ta.file_type, ta.file_size, ta.created_at,
        u.name AS uploader_name, u.username AS uploader_username
      FROM task_attachments ta
      JOIN users u ON ta.user_id = u.id
      WHERE ta.task_id = ?
      ORDER BY ta.created_at DESC
    `).all(taskId);

    return res.json({ attachments });
  } catch (err) {
    console.error('List attachments error:', err);
    return res.status(500).json({ error: 'Failed to retrieve attachments.' });
  }
});

/**
 * GET /api/tasks/:id/attachments/:attachmentId
 * Download / view specific attachment payload
 */
router.get('/:id/attachments/:attachmentId', async (req, res) => {
  try {
    const taskId = parseInt(req.params.id, 10);
    const attachmentId = parseInt(req.params.attachmentId, 10);

    if (isNaN(taskId) || isNaN(attachmentId)) {
      return res.status(400).json({ error: 'Invalid task or attachment ID.' });
    }

    let task = db.prepare('SELECT id, assigned_to, assigned_by FROM tasks WHERE id = ?').get(taskId);
    if (!task) {
      try { await syncTurso(true); } catch (_) {}
      task = db.prepare('SELECT id, assigned_to, assigned_by FROM tasks WHERE id = ?').get(taskId);
    }
    if (!task) {
      return res.status(404).json({ error: 'Task not found.' });
    }

    if (req.user.role !== 'admin' && task.assigned_to !== req.user.id && task.assigned_by !== req.user.id) {
      return res.status(403).json({ error: 'Access denied.' });
    }

    let att = db.prepare('SELECT id, filename, file_type, file_data FROM task_attachments WHERE id = ? AND task_id = ?').get(attachmentId, taskId);
    if (!att) {
      try { await syncTurso(true); } catch (_) {}
      att = db.prepare('SELECT id, filename, file_type, file_data FROM task_attachments WHERE id = ? AND task_id = ?').get(attachmentId, taskId);
    }
    if (!att) {
      return res.status(404).json({ error: 'Attachment not found.' });
    }

    const buffer = Buffer.from(att.file_data, 'base64');
    res.setHeader('Content-Type', att.file_type || 'application/octet-stream');
    res.setHeader('Content-Length', buffer.length);
    res.setHeader('Content-Disposition', `inline; filename="${encodeURIComponent(att.filename)}"`);
    return res.send(buffer);
  } catch (err) {
    console.error('Download attachment error:', err);
    return res.status(500).json({ error: 'Failed to retrieve attachment.' });
  }
});

/**
 * DELETE /api/tasks/:id/attachments/:attachmentId
 * Delete attachment (Uploader or Admin)
 */
router.delete('/:id/attachments/:attachmentId', async (req, res) => {
  try {
    const taskId = parseInt(req.params.id, 10);
    const attachmentId = parseInt(req.params.attachmentId, 10);

    if (isNaN(taskId) || isNaN(attachmentId)) {
      return res.status(400).json({ error: 'Invalid task or attachment ID.' });
    }

    const att = db.prepare('SELECT id, user_id, filename FROM task_attachments WHERE id = ? AND task_id = ?').get(attachmentId, taskId);
    if (!att) {
      return res.status(404).json({ error: 'Attachment not found.' });
    }

    // Permission check: Admin or the user who uploaded the file
    if (req.user.role !== 'admin' && att.user_id !== req.user.id) {
      return res.status(403).json({ error: 'You are only authorized to delete attachments you uploaded.' });
    }

    // Remote Turso deletion
    if (turso) {
      try {
        await turso.execute({ sql: 'DELETE FROM task_attachments WHERE id = ?', args: [attachmentId] });
      } catch (tErr) {
        console.warn('[Turso Attachment Delete Warning]', tErr.message);
      }
    }

    db.prepare('DELETE FROM task_attachments WHERE id = ?').run(attachmentId);

    // Audit log
    db.prepare(`
      INSERT INTO audit_logs (action, actor_id, target_id, details)
      VALUES ('TASK_ATTACHMENT_DELETED', ?, ?, ?)
    `).run(req.user.id, taskId, sanitizeLogText(`User ${req.user.username} deleted attachment "${att.filename}" (ID #${attachmentId}) from task #${taskId}`));

    try { await flushTurso(); } catch (_) {}

    return res.json({ success: true, message: 'Attachment deleted successfully.' });
  } catch (err) {
    console.error('Delete attachment error:', err);
    return res.status(500).json({ error: 'Failed to delete attachment.' });
  }
});

module.exports = router;
