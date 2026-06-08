require('dotenv').config();
const express   = require('express');
const cors      = require('cors');

const authRoutes  = require('./routes/auth');
const convRoutes  = require('./routes/conversations');
const msgRoutes   = require('./routes/messages');
const adminRoutes = require('./routes/admin');

const app = express();

/* ── CORS ── */
const allowedOrigins = [
  process.env.FRONTEND_URL || 'http://127.0.0.1:5500',
  'http://localhost:5500',
  'http://127.0.0.1:5501',
  'http://localhost:5501',
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

/* ── 404 ── */
app.use((req, res) => {
  res.status(404).json({ error: `Route ${req.method} ${req.path} not found.` });
});

/* ── Global error handler ── */
app.use((err, req, res, next) => {   // eslint-disable-line no-unused-vars
  console.error('Unhandled error:', err.message);
  res.status(500).json({ error: 'Internal server error.' });
});

module.exports = app;
