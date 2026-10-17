const path = require('node:path');
require('dotenv').config();

module.exports = {
  port: parseInt(process.env.PORT, 10) || 3000,
  env: process.env.NODE_ENV || 'development',
  sessionSecret: process.env.SESSION_SECRET || 'tetrasync_work_portal_secure_session_token_key_2026_x89a',
  dbPath: path.resolve(process.env.DB_PATH || (process.env.VERCEL ? '/tmp/work_portal.db' : 'data/work_portal.db')),
  tursoUrl: process.env.TURSO_DATABASE_URL || process.env.STORAGE_TURSO_DATABASE_URL || process.env.STORAGE_DATABASE_URL || process.env.TURSO_URL || process.env.STORAGE_URL,
  tursoAuthToken: process.env.TURSO_AUTH_TOKEN || process.env.STORAGE_TURSO_AUTH_TOKEN || process.env.STORAGE_AUTH_TOKEN || process.env.TURSO_TOKEN,
  
  // Pre-configured Administrators
  admins: [
    { username: 'joshua', name: 'J. Joshua', role: 'admin', department: 'Executive / CTO' },
    { username: 'kishore', name: 'B. Kishore', role: 'admin', department: 'Executive / CEO' },
    { username: 'jason', name: 'A. Jason Kister', role: 'admin', department: 'Executive / COO' },
    { username: 'akshay', name: 'Akshay Kumar', role: 'admin', department: 'Executive / Co-CTO' }
  ],

  // Pre-configured Foundational Employees
  employees: [
    { username: 'prashetha', name: 'Prashetha', role: 'employee', department: 'Web management' },
    { username: 'chethana', name: 'Chethana', role: 'employee', department: 'Digital marketing' },
    { username: 'surya', name: 'Surya', role: 'employee', department: 'Cyber Security' },
    { username: 'harish', name: 'Harish', role: 'employee', department: 'Designer' }
  ],

  // Recognized Departments / Roles
  standardDepartments: [
    'Web management',
    'Digital marketing',
    'Cyber Security',
    'Designer',
    'Software & Embedded',
    'Hardware & Avionics',
    'Quality & Testing',
    'Operations'
  ],

  adminDefaultPassword: process.env.ADMIN_DEFAULT_PASSWORD || 'Admin@TetraSync2026!',
  employeeDefaultPassword: process.env.EMPLOYEE_DEFAULT_PASSWORD || 'username@TetraSync!',
  getEmployeeDefaultPassword(username) {
    if (process.env.EMPLOYEE_DEFAULT_PASSWORD && process.env.EMPLOYEE_DEFAULT_PASSWORD !== 'username@TetraSync!') {
      return process.env.EMPLOYEE_DEFAULT_PASSWORD;
    }
    const clean = String(username || '').trim().toLowerCase();
    return `${clean}@TetraSync!`;
  }
};
