const { DatabaseSync } = require('node:sqlite');
const fs = require('node:fs');
const path = require('node:path');
const crypto = require('node:crypto');
const config = require('./config');
const { createClient } = require('@libsql/client/web');

// Ensure database directory exists
fs.mkdirSync(path.dirname(config.dbPath), { recursive: true });

// Initialize local SQLite database
const localDb = new DatabaseSync(config.dbPath);

// Enable WAL mode & foreign keys
try {
  localDb.exec(`
    PRAGMA journal_mode = WAL;
    PRAGMA foreign_keys = ON;
  `);
} catch (_) {}

// Optional Turso client using pure HTTP web client (zero native binaries, zero lambda crashes)
let turso = null;
if (config.tursoUrl && config.tursoAuthToken) {
  try {
    turso = createClient({
      url: config.tursoUrl,
      authToken: config.tursoAuthToken
    });
    console.log('[Turso Web] Connected to cloud primary over HTTPS:', config.tursoUrl);
  } catch (err) {
    console.error('[Turso Web Init Error]', err);
  }
}

// Create Schema
localDb.exec(`
  CREATE TABLE IF NOT EXISTS users (
    id INTEGER PRIMARY KEY AUTOINCREMENT,
    name TEXT NOT NULL,
    username TEXT UNIQUE NOT NULL,
    email TEXT NULL,
    password_hash TEXT NOT NULL,
    salt TEXT NOT NULL,
    role TEXT NOT NULL DEFAULT 'employee',
    department TEXT DEFAULT 'General',
    status TEXT NOT NULL DEFAULT 'pending',
    rejection_reason TEXT NULL,
    notes TEXT NULL,
    created_at DATETIME DEFAULT CURRENT_TIMESTAMP,
    approved_at DATETIME NULL,
    approved_by INTEGER NULL,
    last_login_at DATETIME NULL,
    FOREIGN KEY (approved_by) REFERENCES users(id) ON DELETE SET NULL
  );

  CREATE TABLE IF NOT EXISTS sessions (
    id TEXT PRIMARY KEY,
    user_id INTEGER NOT NULL,
    created_at DATETIME DEFAULT CURRENT_TIMESTAMP,
    expires_at DATETIME NOT NULL,
    FOREIGN KEY (user_id) REFERENCES users(id) ON DELETE CASCADE
  );

  CREATE TABLE IF NOT EXISTS revoked_sessions (
    id TEXT PRIMARY KEY,
    revoked_at DATETIME DEFAULT CURRENT_TIMESTAMP
  );

  CREATE TABLE IF NOT EXISTS tasks (
    id INTEGER PRIMARY KEY AUTOINCREMENT,
    title TEXT NOT NULL,
    description TEXT NOT NULL,
    priority TEXT NOT NULL DEFAULT 'medium',
    status TEXT NOT NULL DEFAULT 'pending',
    progress_percent INTEGER DEFAULT 0,
    assigned_to INTEGER NOT NULL,
    assigned_by INTEGER NOT NULL,
    due_date TEXT NULL,
    category TEXT DEFAULT 'General',
    created_at DATETIME DEFAULT CURRENT_TIMESTAMP,
    updated_at DATETIME DEFAULT CURRENT_TIMESTAMP,
    FOREIGN KEY (assigned_to) REFERENCES users(id) ON DELETE CASCADE,
    FOREIGN KEY (assigned_by) REFERENCES users(id) ON DELETE RESTRICT
  );

  CREATE TABLE IF NOT EXISTS task_updates (
    id INTEGER PRIMARY KEY AUTOINCREMENT,
    task_id INTEGER NOT NULL,
    user_id INTEGER NOT NULL,
    old_status TEXT NULL,
    new_status TEXT NULL,
    progress_percent INTEGER NULL,
    note TEXT NOT NULL,
    created_at DATETIME DEFAULT CURRENT_TIMESTAMP,
    FOREIGN KEY (task_id) REFERENCES tasks(id) ON DELETE CASCADE,
    FOREIGN KEY (user_id) REFERENCES users(id) ON DELETE CASCADE
  );

  CREATE TABLE IF NOT EXISTS audit_logs (
    id INTEGER PRIMARY KEY AUTOINCREMENT,
    action TEXT NOT NULL,
    actor_id INTEGER NULL,
    target_id INTEGER NULL,
    details TEXT NULL,
    created_at DATETIME DEFAULT CURRENT_TIMESTAMP
  );

  CREATE INDEX IF NOT EXISTS idx_users_username ON users(username);
  CREATE INDEX IF NOT EXISTS idx_users_status ON users(status);
  CREATE INDEX IF NOT EXISTS idx_sessions_user_id ON sessions(user_id);
  CREATE INDEX IF NOT EXISTS idx_tasks_assigned_to ON tasks(assigned_to);
  CREATE INDEX IF NOT EXISTS idx_tasks_status ON tasks(status);
  CREATE INDEX IF NOT EXISTS idx_task_updates_task_id ON task_updates(task_id);
`);

/**
 * Hash password with scrypt
 */
function hashPassword(password, salt = null) {
  const activeSalt = salt || crypto.randomBytes(16).toString('hex');
  const hash = crypto.scryptSync(password, activeSalt, 64).toString('hex');
  return { hash, salt: activeSalt };
}

/**
 * Verify password against stored hash & salt
 */
function verifyPassword(password, hash, salt) {
  const calculatedHash = crypto.scryptSync(password, salt, 64).toString('hex');
  const bufA = Buffer.from(hash, 'hex');
  const bufB = Buffer.from(calculatedHash, 'hex');
  if (bufA.length !== bufB.length) return false;
  return crypto.timingSafeEqual(bufA, bufB);
}

// Run non-destructive column migration for email
try {
  localDb.exec(`ALTER TABLE users ADD COLUMN email TEXT NULL;`);
} catch (_) {}

// Seed Initial Admin and Foundational Employee Accounts with deterministic IDs
function seedAccounts() {
  // Seed Admins: 1: joshua, 2: kishore, 3: jason, 4: akshay
  config.admins.forEach((admin, idx) => {
    const cleanUser = admin.username.toLowerCase();
    const existing = localDb.prepare('SELECT id FROM users WHERE username = ?').get(cleanUser);
    const { hash, salt } = hashPassword(config.adminDefaultPassword);
    if (existing) {
      localDb.prepare(`
        UPDATE users SET name = ?, department = ?, email = ?, password_hash = ?, salt = ?, role = 'admin', status = 'approved'
        WHERE id = ?
      `).run(admin.name, admin.department, admin.email || null, hash, salt, existing.id);
    } else {
      const fixedId = idx + 1;
      localDb.prepare(`
        INSERT OR IGNORE INTO users (id, name, username, email, password_hash, salt, role, department, status, approved_at)
        VALUES (?, ?, ?, ?, ?, ?, 'admin', ?, 'approved', CURRENT_TIMESTAMP)
      `).run(fixedId, admin.name, cleanUser, admin.email || null, hash, salt, admin.department);
    }
  });

  // Seed Foundational Employees: 5: prashetha, 6: chethana, 7: surya, 8: bhuvanika, 9: harish
  config.employees.forEach((emp, idx) => {
    const cleanUser = emp.username.toLowerCase();
    const existing = localDb.prepare('SELECT id FROM users WHERE username = ?').get(cleanUser);
    const empPassword = config.getEmployeeDefaultPassword(cleanUser);
    const { hash, salt } = hashPassword(empPassword);
    if (existing) {
      localDb.prepare(`
        UPDATE users SET name = ?, department = ?, email = ?, password_hash = ?, salt = ?, role = 'employee', status = 'approved'
        WHERE id = ?
      `).run(emp.name, emp.department, emp.email || null, hash, salt, existing.id);
    } else {
      const fixedId = idx + 5;
      localDb.prepare(`
        INSERT OR IGNORE INTO users (id, name, username, email, password_hash, salt, role, department, status, approved_at)
        VALUES (?, ?, ?, ?, ?, ?, 'employee', ?, 'approved', CURRENT_TIMESTAMP)
      `).run(fixedId, emp.name, cleanUser, emp.email || null, hash, salt, emp.department);
    }
  });
}

seedAccounts();

// Async Turso synchronization engine
async function initTursoRemote() {
  if (!turso) return;
  try {
    await turso.executeMultiple(`
      CREATE TABLE IF NOT EXISTS users (
        id INTEGER PRIMARY KEY AUTOINCREMENT,
        name TEXT NOT NULL,
        username TEXT UNIQUE NOT NULL,
        email TEXT NULL,
        password_hash TEXT NOT NULL,
        salt TEXT NOT NULL,
        role TEXT NOT NULL DEFAULT 'employee',
        department TEXT DEFAULT 'General',
        status TEXT NOT NULL DEFAULT 'pending',
        rejection_reason TEXT NULL,
        notes TEXT NULL,
        created_at DATETIME DEFAULT CURRENT_TIMESTAMP,
        approved_at DATETIME NULL,
        approved_by INTEGER NULL,
        last_login_at DATETIME NULL
      );
      CREATE TABLE IF NOT EXISTS tasks (
        id INTEGER PRIMARY KEY AUTOINCREMENT,
        title TEXT NOT NULL,
        description TEXT NOT NULL,
        priority TEXT NOT NULL DEFAULT 'medium',
        status TEXT NOT NULL DEFAULT 'pending',
        progress_percent INTEGER DEFAULT 0,
        assigned_to INTEGER NOT NULL,
        assigned_by INTEGER NOT NULL,
        due_date TEXT NULL,
        category TEXT DEFAULT 'General',
        created_at DATETIME DEFAULT CURRENT_TIMESTAMP,
        updated_at DATETIME DEFAULT CURRENT_TIMESTAMP
      );
      CREATE TABLE IF NOT EXISTS task_updates (
        id INTEGER PRIMARY KEY AUTOINCREMENT,
        task_id INTEGER NOT NULL,
        user_id INTEGER NOT NULL,
        old_status TEXT NULL,
        new_status TEXT NULL,
        progress_percent INTEGER NULL,
        note TEXT NOT NULL,
        created_at DATETIME DEFAULT CURRENT_TIMESTAMP
      );
      CREATE TABLE IF NOT EXISTS audit_logs (
        id INTEGER PRIMARY KEY AUTOINCREMENT,
        action TEXT NOT NULL,
        actor_id INTEGER NULL,
        target_id INTEGER NULL,
        details TEXT NULL,
        created_at DATETIME DEFAULT CURRENT_TIMESTAMP
      );
    `);

    // Non-destructive Turso cloud column migration for email
    try {
      await turso.execute(`ALTER TABLE users ADD COLUMN email TEXT;`);
    } catch (_) {}

    // Ensure seed accounts exist in remote Turso
    for (let idx = 0; idx < config.admins.length; idx++) {
      const admin = config.admins[idx];
      const cleanUser = admin.username.toLowerCase();
      const fixedId = idx + 1;
      const { hash, salt } = hashPassword(config.adminDefaultPassword);

      const userCheck = await turso.execute({
        sql: `SELECT id FROM users WHERE LOWER(username) = ?`,
        args: [cleanUser]
      });

      if (userCheck.rows && userCheck.rows.length > 0) {
        await turso.execute({
          sql: `UPDATE users SET name = ?, department = ?, email = ?, password_hash = ?, salt = ?, role = 'admin', status = 'approved' WHERE LOWER(username) = ?`,
          args: [admin.name, admin.department, admin.email || null, hash, salt, cleanUser]
        });
      } else {
        try {
          await turso.execute({
            sql: `INSERT INTO users (id, name, username, email, password_hash, salt, role, department, status, approved_at) VALUES (?, ?, ?, ?, ?, ?, 'admin', ?, 'approved', CURRENT_TIMESTAMP)`,
            args: [fixedId, admin.name, cleanUser, admin.email || null, hash, salt, admin.department]
          });
        } catch (_) {
          await turso.execute({
            sql: `INSERT INTO users (name, username, email, password_hash, salt, role, department, status, approved_at) VALUES (?, ?, ?, ?, ?, 'admin', ?, 'approved', CURRENT_TIMESTAMP)`,
            args: [admin.name, cleanUser, admin.email || null, hash, salt, admin.department]
          });
        }
      }
    }

    for (let idx = 0; idx < config.employees.length; idx++) {
      const emp = config.employees[idx];
      const cleanUser = emp.username.toLowerCase();
      const fixedId = idx + 5;
      const empPassword = config.getEmployeeDefaultPassword(cleanUser);
      const { hash, salt } = hashPassword(empPassword);

      const userCheck = await turso.execute({
        sql: `SELECT id FROM users WHERE LOWER(username) = ?`,
        args: [cleanUser]
      });

      if (userCheck.rows && userCheck.rows.length > 0) {
        await turso.execute({
          sql: `UPDATE users SET name = ?, department = ?, email = ?, password_hash = ?, salt = ?, role = 'employee', status = 'approved' WHERE LOWER(username) = ?`,
          args: [emp.name, emp.department, emp.email || null, hash, salt, cleanUser]
        });
      } else {
        try {
          await turso.execute({
            sql: `INSERT INTO users (id, name, username, email, password_hash, salt, role, department, status, approved_at) VALUES (?, ?, ?, ?, ?, ?, 'employee', ?, 'approved', CURRENT_TIMESTAMP)`,
            args: [fixedId, emp.name, cleanUser, emp.email || null, hash, salt, emp.department]
          });
        } catch (_) {
          await turso.execute({
            sql: `INSERT INTO users (name, username, email, password_hash, salt, role, department, status, approved_at) VALUES (?, ?, ?, ?, ?, 'employee', ?, 'approved', CURRENT_TIMESTAMP)`,
            args: [emp.name, cleanUser, emp.email || null, hash, salt, emp.department]
          });
        }
      }
    }

    // Initial pull
    await pullFromTurso();
  } catch (err) {
    console.warn('[Turso Init Warning]', err.message);
  }
}

// Pull latest data from Turso into local SQLite replica
async function pullFromTurso() {
  if (!turso) return;
  try {
    // Sync tasks
    const rTasks = await turso.execute('SELECT * FROM tasks');
    if (rTasks.rows && rTasks.rows.length > 0) {
      const insTask = localDb.prepare(`
        INSERT OR REPLACE INTO tasks (id, title, description, priority, status, progress_percent, assigned_to, assigned_by, due_date, category, created_at, updated_at)
        VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
      `);
      for (const t of rTasks.rows) {
        insTask.run(
          Number(t.id),
          String(t.title),
          String(t.description),
          String(t.priority),
          String(t.status),
          Number(t.progress_percent ?? 0),
          Number(t.assigned_to),
          Number(t.assigned_by),
          t.due_date ? String(t.due_date) : null,
          t.category ? String(t.category) : 'General',
          String(t.created_at),
          String(t.updated_at)
        );
      }
      // Prune local tasks and updates that were deleted on Turso primary
      const tursoTaskIds = rTasks.rows.map(t => Number(t.id));
      const placeholders = tursoTaskIds.map(() => '?').join(',');
      localDb.prepare(`DELETE FROM tasks WHERE id NOT IN (${placeholders})`).run(...tursoTaskIds);
      localDb.prepare(`DELETE FROM task_updates WHERE task_id NOT IN (${placeholders})`).run(...tursoTaskIds);
    } else {
      localDb.exec('DELETE FROM tasks; DELETE FROM task_updates;');
    }

    // Sync task_updates
    const rUpdates = await turso.execute('SELECT * FROM task_updates');
    if (rUpdates.rows && rUpdates.rows.length > 0) {
      const insUp = localDb.prepare(`
        INSERT OR REPLACE INTO task_updates (id, task_id, user_id, old_status, new_status, progress_percent, note, created_at)
        VALUES (?, ?, ?, ?, ?, ?, ?, ?)
      `);
      for (const u of rUpdates.rows) {
        insUp.run(
          Number(u.id),
          Number(u.task_id),
          Number(u.user_id),
          u.old_status ? String(u.old_status) : null,
          u.new_status ? String(u.new_status) : null,
          u.progress_percent !== null && u.progress_percent !== undefined ? Number(u.progress_percent) : null,
          String(u.note),
          String(u.created_at)
        );
      }
      const tursoUpIds = rUpdates.rows.map(u => Number(u.id));
      const upPlaceholders = tursoUpIds.map(() => '?').join(',');
      localDb.prepare(`DELETE FROM task_updates WHERE id NOT IN (${upPlaceholders})`).run(...tursoUpIds);
    } else {
      localDb.exec('DELETE FROM task_updates;');
    }

    // Sync users defensively
    const rUsers = await turso.execute('SELECT * FROM users');
    if (rUsers.rows && rUsers.rows.length > 0) {
      const insUser = localDb.prepare(`
        INSERT OR REPLACE INTO users (id, name, username, email, password_hash, salt, role, department, status, rejection_reason, notes, created_at, approved_at, approved_by, last_login_at)
        VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
      `);
      for (const u of rUsers.rows) {
        const cleanU = String(u.username || '').toLowerCase();
        // If a local user exists with this username under a different ID, delete the local conflicting row first
        const localConflict = localDb.prepare('SELECT id FROM users WHERE username = ?').get(cleanU);
        if (localConflict && localConflict.id !== Number(u.id)) {
          localDb.prepare('DELETE FROM users WHERE id = ?').run(localConflict.id);
        }
        insUser.run(
          Number(u.id),
          String(u.name || ''),
          cleanU,
          u.email ? String(u.email) : null,
          String(u.password_hash || ''),
          String(u.salt || ''),
          String(u.role || 'employee'),
          String(u.department ?? 'General'),
          String(u.status || 'pending'),
          u.rejection_reason ? String(u.rejection_reason) : null,
          u.notes ? String(u.notes) : null,
          String(u.created_at || new Date().toISOString()),
          u.approved_at ? String(u.approved_at) : null,
          u.approved_by !== null && u.approved_by !== undefined ? Number(u.approved_by) : null,
          u.last_login_at ? String(u.last_login_at) : null
        );
      }
    }
  } catch (err) {
    console.warn('[Turso Pull Warning]', err.message);
  }
}

let tursoInitPromise = null;
if (turso) {
  tursoInitPromise = initTursoRemote().catch((err) => {
    console.warn('[Turso Background Init Warning]', err.message);
  });
}

async function ensureTursoInit() {
  if (tursoInitPromise) {
    try {
      await tursoInitPromise;
    } catch (_) {}
  }
}

let lastSyncTime = 0;
let isSyncing = false;
async function syncTurso(force = false) {
  if (!turso || isSyncing) return;
  await ensureTursoInit();
  const now = Date.now();
  if (!force && now - lastSyncTime < 3000) return; // Debounce 3s
  lastSyncTime = now;
  isSyncing = true;
  try {
    await pullFromTurso();
  } catch (err) {
    console.warn('[Turso Sync Error]', err.message);
  } finally {
    isSyncing = false;
  }
}

// Track pending Turso cloud mutations to ensure serverless functions don't freeze before writes complete
let pendingTursoWrites = [];

async function flushTurso() {
  if (!turso) return;
  while (pendingTursoWrites.length > 0) {
    const currentWrites = pendingTursoWrites;
    pendingTursoWrites = [];
    try {
      await Promise.allSettled(currentWrites);
    } catch (err) {
      console.warn('[Turso Flush Error]', err.message);
    }
  }
}

function isMutationQuery(sql) {
  const trimmed = sql.trim().toUpperCase();
  return trimmed.startsWith('INSERT') || trimmed.startsWith('UPDATE') || trimmed.startsWith('DELETE') || trimmed.startsWith('REPLACE');
}

// Wrapper for clean API & seamless Turso HTTP dual-write
const db = {
  rawDb: localDb,
  exec(sql) {
    return localDb.exec(sql);
  },
  prepare(sql) {
    const localStmt = localDb.prepare(sql);
    const isMutation = isMutationQuery(sql);

    return {
      run(...args) {
        const result = localStmt.run(...args);
        // If Turso is connected, push mutation to remote cloud primary and track for flushing
        if (turso && isMutation) {
          const writePromise = turso.execute({ sql, args }).catch(err => {
            console.warn('[Turso Remote Push Error]', err.message);
          });
          pendingTursoWrites.push(writePromise);
        }
        return {
          changes: Number(result.changes),
          lastInsertRowid: Number(result.lastInsertRowid)
        };
      },
      get(...args) {
        const row = localStmt.get(...args);
        if (row && typeof row === 'object' && '_metadata' in row) {
          delete row._metadata;
        }
        return row;
      },
      all(...args) {
        const rows = localStmt.all(...args);
        if (Array.isArray(rows)) {
          for (let i = 0; i < rows.length; i++) {
            if (rows[i] && typeof rows[i] === 'object' && '_metadata' in rows[i]) {
              delete rows[i]._metadata;
            }
          }
        }
        return rows;
      }
    };
  }
};

module.exports = {
  db,
  turso,
  hashPassword,
  verifyPassword,
  syncTurso,
  flushTurso,
  ensureTursoInit
};
