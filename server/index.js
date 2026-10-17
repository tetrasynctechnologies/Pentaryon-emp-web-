const express = require('express');
const path = require('node:path');
const helmet = require('helmet');
const cors = require('cors');
const cookieParser = require('cookie-parser');
const config = require('./config');

// Initialize database & tables
const { syncTurso, flushTurso } = require('./db');

const authRoutes = require('./routes/auth.routes');
const adminRoutes = require('./routes/admin.routes');
const tasksRoutes = require('./routes/tasks.routes');

const app = express();

// Trust reverse proxy (e.g. Nginx, Cloudflare, load balancers)
app.set('trust proxy', 1);

const { originGuard } = require('./security');

// Security Headers (Zero External CDN Dependency)
app.use(
  helmet({
    contentSecurityPolicy: {
      directives: {
        defaultSrc: ["'self'"],
        scriptSrc: ["'self'"],
        scriptSrcAttr: ["'none'"],
        styleSrc: ["'self'", "'unsafe-inline'"],
        imgSrc: ["'self'", "data:"],
        connectSrc: ["'self'"],
        fontSrc: ["'self'", "data:"],
        objectSrc: ["'none'"],
        baseUri: ["'self'"],
        formAction: ["'self'"],
        frameAncestors: ["'none'"]
      }
    },
    crossOriginEmbedderPolicy: false
  })
);

// Strict CORS: Prevent cross-origin credential reflection and exfiltration
app.use(
  cors({
    origin: function (origin, callback) {
      if (!origin) return callback(null, true);
      try {
        const originUrl = new URL(origin);
        const isLocal = originUrl.hostname === 'localhost' || originUrl.hostname === '127.0.0.1';
        const isVercel = originUrl.hostname.endsWith('.vercel.app');
        if (isLocal || isVercel) {
          return callback(null, true);
        }
      } catch (_) {}
      return callback(null, false);
    },
    credentials: true
  })
);
app.use(cookieParser(config.sessionSecret));
app.use(express.json({ limit: '1mb' }));
app.use(express.urlencoded({ extended: true, limit: '1mb' }));

// Serve static frontend assets
app.use(express.static(path.join(__dirname, '..', 'public')));

// Public Metadata for frontend dropdowns & brand info
app.get(['/api/meta', '/meta'], (req, res) => {
  res.json({
    departments: config.standardDepartments,
    company: 'TetraSync Technologies',
    storage: (config.tursoUrl && config.tursoAuthToken) ? 'turso' : 'sqlite',
    admins: config.admins.map(a => ({ name: a.name, username: a.username, department: a.department }))
  });
});

// Root API ping / health
app.get(['/api', '/api/health', '/health'], (req, res) => {
  res.json({
    status: 'ok',
    system: 'TetraSync Technologies Workplace Gate',
    version: '1.0.0',
    storage: (config.tursoUrl && config.tursoAuthToken) ? 'turso' : 'sqlite'
  });
});

// CSRF / Origin Guard on mutative API requests
app.use(['/api', '/auth', '/admin', '/tasks'], originGuard);

// Sync with Turso cloud primary when enabled
app.use(['/api', '/auth', '/admin', '/tasks'], async (req, res, next) => {
  try {
    await syncTurso();
  } catch (_) {}
  next();
});

// Ensure all Turso cloud mutations are flushed before finishing HTTP responses in serverless
app.use(['/api', '/auth', '/admin', '/tasks'], (req, res, next) => {
  const originalJson = res.json.bind(res);
  res.json = async function (data) {
    try {
      await flushTurso();
    } catch (_) {}
    return originalJson(data);
  };
  next();
});

// Mount Routes (dual mounted to guarantee matching regardless of serverless path rewriting)
app.use(['/api/auth', '/auth'], authRoutes);
app.use(['/api/admin', '/admin'], adminRoutes);
app.use(['/api/tasks', '/tasks'], tasksRoutes);

// Legal pages explicit routes
app.get('/terms', (req, res) => {
  res.sendFile(path.join(__dirname, '..', 'public', 'terms.html'));
});

app.get('/privacy', (req, res) => {
  res.sendFile(path.join(__dirname, '..', 'public', 'privacy.html'));
});

// SPA fallback for all other routes
app.get('*', (req, res) => {
  res.sendFile(path.join(__dirname, '..', 'public', 'index.html'));
});

// Global Error Handler
app.use((err, req, res, next) => {
  console.error('[Unhandled Error]', err);
  res.status(500).json({ error: 'Internal server error occurred.' });
});

// Process Resilience Handlers
process.on('uncaughtException', (err) => {
  console.error('[Uncaught Exception]', err);
});
process.on('unhandledRejection', (reason, promise) => {
  console.error('[Unhandled Rejection]', reason);
});

// Start Server
if (require.main === module) {
  const server = app.listen(config.port, () => {
    console.log(`=======================================================`);
    console.log(` TetraSync Technologies - Work Portal & Clearance System `);
    console.log(` Running on: http://localhost:${config.port}                `);
    console.log(` Environment: ${config.env}                             `);
    console.log(` Database: node:sqlite (WAL mode)                      `);
    console.log(`=======================================================`);
  });

  server.on('error', (err) => {
    console.error('[Server Error]', err);
  });
}

module.exports = app;

