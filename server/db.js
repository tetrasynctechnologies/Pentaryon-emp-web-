const fs = require('node:fs');
const path = require('node:path');
const crypto = require('node:crypto');
const config = require('./config');

// Ensure database directory exists
fs.mkdirSync(path.dirname(config.dbPath), { recursive: true });

let DatabaseEngine;
try {
  DatabaseEngine = require('libsql');
} catch (_) {
  DatabaseEngine = require('node:sqlite').DatabaseSync;
}

let rawDb = null;
let isTursoActive = false;

if (config.tursoUrl && config.tursoAuthToken && typeof DatabaseEngine === 'function') {
  try {
    rawDb = new DatabaseEngine(config.dbPath, {
      syncUrl: config.tursoUrl,
      authToken: config.tursoAuthToken,
      readYourWrites: true
    });
    try {
      rawDb.sync();
    } catch (syncErr) {
      console.warn('[Turso Initial Sync Warning]', syncErr.message);
    }
    isTursoActive = true;
    console.log('[Turso] Initialized native embedded replica with primary:', config.tursoUrl);
  } catch (openErr) {
    console.warn('[Turso Open Warning]', openErr.message, '- recreating local replica file...');
    try {
      if (fs.existsSync(config.dbPath)) fs.unlinkSync(config.dbPath);
      if (fs.existsSync(config.dbPath + '-wal')) fs.unlinkSync(config.dbPath + '-wal');
      if (fs.existsSync(config.dbPath + '-shm')) fs.unlinkSync(config.dbPath + '-shm');
    } catch (_) {}

    try {
      rawDb = new DatabaseEngine(config.dbPath, {
        syncUrl: config.tursoUrl,
        authToken: config.tursoAuthToken,
        readYourWrites: true
      });
      try {
        rawDb.sync();
      } catch (syncErr) {
        console.warn('[Turso Sync Warning after recreation]', syncErr.message);
      }
      isTursoActive = true;
      console.log('[Turso] Successfully recreated and connected embedded replica:', config.tursoUrl);
    } catch (fallbackErr) {
      console.error('[Turso Fallback to local SQLite]', fallbackErr.message);
      rawDb = new DatabaseEngine(config.dbPath);
    }
  }
} else {
  rawDb = new DatabaseEngine(config.dbPath);
}

// Wrapper for clean API & metadata stripping
const db = {
  rawDb,
  exec(sql) {
    return rawDb.exec(sql);
  },
  sync() {
    if (isTursoActive && typeof rawDb.sync === 'function') {
      try {
        return rawDb.sync();
      } catch (err) {
        console.warn('[Turso Sync Warning]', err.message);
      }
    }
  },
  prepare(sql) {
    const stmt = rawDb.prepare(sql);
    return {
      run(...args) {
        return stmt.run(...args);
      },
      get(...args) {
        const row = stmt.get(...args);
        if (row && typeof row === 'object' && '_metadata' in row) {
          delete row._metadata;
        }
        return row;
      },
      all(...args) {
        const rows = stmt.all(...args);
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

// Enable foreign keys & WAL mode
try {
  db.exec('PRAGMA foreign_keys = ON;');
} catch (_) {}

let lastSyncTime = 0;
function syncTurso(force = false) {
  if (!isTursoActive || !rawDb || typeof rawDb.sync !== 'function') return;
  const now = Date.now();
  if (!force && now - lastSyncTime < 2000) return; // Debounce 2s
  lastSyncTime = now;
  try {
    rawDb.sync();
  } catch (err) {
    console.warn('[Turso Sync Error]', err.message);
  }
}

// Create Schema
db.exec(`
  CREATE TABLE IF NOT EXISTS users (
    id INTEGER PRIMARY KEY AUTOINCREMENT,
    name TEXT NOT NULL,
    username TEXT UNIQUE NOT NULL,
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

// Seed Initial Admin and Foundational Employee Accounts with deterministic IDs
function seedAccounts() {
  const insertUserStmt = db.prepare(`
    INSERT OR REPLACE INTO users (id, name, username, password_hash, salt, role, department, status, approved_at)
    VALUES (?, ?, ?, ?, ?, ?, ?, 'approved', CURRENT_TIMESTAMP)
  `);

  // Seed Admins: 1: joshua, 2: kishore, 3: jason, 4: akshay
  config.admins.forEach((admin, idx) => {
    const fixedId = idx + 1;
    const { hash, salt } = hashPassword(config.adminDefaultPassword);
    insertUserStmt.run(fixedId, admin.name, admin.username.toLowerCase(), hash, salt, 'admin', admin.department);
  });

  // Seed Foundational Employees: 5: prashetha, 6: chethana, 7: surya, 8: harish
  config.employees.forEach((emp, idx) => {
    const fixedId = idx + 5;
    const { hash, salt } = hashPassword(config.employeeDefaultPassword);
    insertUserStmt.run(fixedId, emp.name, emp.username.toLowerCase(), hash, salt, 'employee', emp.department);
  });
}

seedAccounts();
if (isTursoActive) {
  syncTurso(true);
}

module.exports = {
  db,
  hashPassword,
  verifyPassword,
  syncTurso
};
