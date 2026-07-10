require('dotenv').config();
const path      = require('path');
const express   = require('express');
const cors      = require('cors');

const authRoutes       = require('./routes/auth');
const convRoutes       = require('./routes/conversations');
const msgRoutes        = require('./routes/messages');
const adminRoutes      = require('./routes/admin');
const workspaceRoutes  = require('./routes/workspaces');
const projectRoutes    = require('./routes/projects');
const aiRoutes         = require('./routes/ai');

const app = express();

/* ── CORS ──
   Now that the backend serves the frontend itself (see below), the browser
   sends Origin: http://localhost:<PORT> for same-origin requests too — that
   must always be allowed, in addition to the Live Server dev ports and
   whatever FRONTEND_URL is set to (e.g. your Railway domain in prod). ── */
const SELF_PORT = process.env.PORT || 3001;
const allowedOrigins = [
  process.env.FRONTEND_URL || 'http://127.0.0.1:5500',
  'http://localhost:5500',
  'http://127.0.0.1:5501',
  'http://localhost:5501',
  `http://localhost:${SELF_PORT}`,
  `http://127.0.0.1:${SELF_PORT}`,
];

app.use(cors({
  origin: (origin, cb) => {
    // Allow requests with no origin (e.g. curl, Postman) and known origins
    if (!origin || allowedOrigins.includes(origin)) return cb(null, true);
    cb(new Error(`CORS: origin ${origin} not allowed`));
  },
  credentials: true,
}));

/* ── Body parsing — 10 MB to handle base64 image attachments ── */
app.use(express.json({ limit: '10mb' }));

/* ── Health check ── */
app.get('/health', (_, res) =>
  res.json({
    status:      'ok',
    service:     'Orion AI Backend',
    timestamp:   new Date(),
    uptime:      Math.floor(process.uptime()),
    memoryMB:    Math.round(process.memoryUsage().heapUsed / 1024 / 1024),
    rssMB:       Math.round(process.memoryUsage().rss      / 1024 / 1024),
    nodeVersion: process.version,
  })
);

/* ── Routes ── */
app.use('/api/auth',                         authRoutes);
app.use('/api/conversations',                convRoutes);
app.use('/api/conversations/:id/messages',   msgRoutes);
app.use('/api/admin',                        adminRoutes);
app.use('/api/workspaces',                   workspaceRoutes);
app.use('/api/projects',                     projectRoutes);
app.use('/api/ai',                           aiRoutes);

/* ── Static frontend ──────────────────────────────────────────────────────
   Serves index.html, script.js, styles.css, landing.html, career.html and
   admin.html from backend/public. This lets one Railway service host both
   the API and the UI on the same origin — no CORS, no separate frontend
   deploy. Locally you can still use Live Server on 5500 if you prefer;
   script.js/admin.html auto-detect that and point at localhost:3001. ── */
app.use(express.static(path.join(__dirname, '..', 'public')));

/* ── 404 (API routes only — static assets are handled above) ── */
app.use('/api', (req, res) => {
  res.status(404).json({ error: `Route ${req.method} ${req.path} not found.` });
});

/* ── Global error handler ── */
app.use((err, req, res, next) => {   // eslint-disable-line no-unused-vars
  console.error('Unhandled error:', err.message);
  res.status(500).json({ error: 'Internal server error.' });
});

module.exports = app;
