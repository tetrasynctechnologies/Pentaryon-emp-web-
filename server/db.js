const { DatabaseSync } = require('node:sqlite');
const fs = require('node:fs');
const path = require('node:path');
const crypto = require('node:crypto');
const config = require('./config');

// Ensure database directory exists
fs.mkdirSync(path.dirname(config.dbPath), { recursive: true });

// Initialize SQLite database
const db = new DatabaseSync(config.dbPath);

// Enable WAL mode & foreign keys for high performance & integrity
db.exec(`
  PRAGMA journal_mode = WAL;
  PRAGMA foreign_keys = ON;
`);

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

// Seed Initial Admin and Foundational Employee Accounts
function seedAccounts() {
  const findUserStmt = db.prepare('SELECT id FROM users WHERE username = ?');
  const insertUserStmt = db.prepare(`
    INSERT INTO users (name, username, password_hash, salt, role, department, status, approved_at)
    VALUES (?, ?, ?, ?, ?, ?, 'approved', CURRENT_TIMESTAMP)
  `);

  // Seed Admins: joshua, kishore, jason, akshay
  for (const admin of config.admins) {
    const existing = findUserStmt.get(admin.username.toLowerCase());
    if (!existing) {
      const { hash, salt } = hashPassword(config.adminDefaultPassword);
      insertUserStmt.run(admin.name, admin.username.toLowerCase(), hash, salt, 'admin', admin.department);
      console.log(`[Seed] Created admin account: ${admin.username}`);
    }
  }

  // Seed Foundational Employees: prashetha, chethana, surya, harish
  for (const emp of config.employees) {
    const existing = findUserStmt.get(emp.username.toLowerCase());
    if (!existing) {
      const { hash, salt } = hashPassword(config.employeeDefaultPassword);
      insertUserStmt.run(emp.name, emp.username.toLowerCase(), hash, salt, 'employee', emp.department);
      console.log(`[Seed] Created employee account: ${emp.username} (${emp.department})`);
    }
  }
}

seedAccounts();

module.exports = {
  db,
  hashPassword,
  verifyPassword
};
