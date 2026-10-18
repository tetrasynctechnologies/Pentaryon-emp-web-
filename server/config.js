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
    { username: 'akshay', name: 'Akshay Kumar M', role: 'admin', department: 'Executive / Co-CTO', email: 'akshaykumar.20073170@gmail.com' }
  ],

  // Pre-configured Foundational Employees
  employees: [
    { username: 'prashetha', name: 'Prashetha G M', role: 'employee', department: 'Web management', email: 'prashe03@gmail.com' },
    { username: 'chethana', name: 'Chethana .K', role: 'employee', department: 'Digital marketing', email: 'chethanakollu@gmail.com' },
    { username: 'surya', name: 'Surya V', role: 'employee', department: 'Cyber Security', email: 'suryavelmurugan05@gmail.com' },
    { username: 'bhuvanika', name: 'Bhuvanika Ch', role: 'employee', department: 'Video Editor', email: 'chennurubhuvanika@gmail.com' },
    { username: 'harish', name: 'Harish', role: 'employee', department: 'Designer' }
  ],

  // Recognized Departments / Roles
  standardDepartments: [
    'Web management',
    'Digital marketing',
    'Cyber Security',
    'Video Editor',
    'Designer',
    'Software & Embedded',
    'Hardware & Avionics',
    'Quality & Testing',
    'Operations'
  ],

  // Gmail Notification Credentials
  gmailUser: process.env.GMAIL_USER || 'tetrasynctech@gmail.com',
  gmailAppPassword: process.env.GMAIL_APP_PASSWORD || '',

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
