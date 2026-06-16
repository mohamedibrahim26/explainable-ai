/**
 * AI proxy routes — Node.js backend → Python FastAPI AI service
 *
 * The Node backend acts as a gateway: it handles auth, rate-limiting (future),
 * and then forwards requests to the Python AI service.
 *
 * Routes:
 *   POST /api/ai/chat           → streaming chat (SSE)
 *   POST /api/ai/roadmap        → career roadmap generation
 *   POST /api/ai/ingest         → file upload + RAG ingest
 *   POST /api/ai/rag/query      → RAG retrieval
 *   POST /api/ai/safety         → content safety check
 *   GET  /api/ai/providers      → available LLM providers
 *   GET  /api/ai/health         → Python service health check
 */

const express  = require('express');
const fetch    = require('node-fetch');
const FormData = require('form-data');
const multer   = require('multer');

const { requireAuth } = require('../middleware/auth');

const router = express.Router();
const upload = multer({ limits: { fileSize: 50 * 1024 * 1024 } }); // 50 MB

const AI_SERVICE_URL = process.env.AI_SERVICE_URL || 'http://localhost:8000';
const AI_SERVICE_KEY = process.env.AI_SERVICE_SECRET || '';

/** Shared headers sent to the Python service */
function aiHeaders(extra = {}) {
  return {
    'Content-Type': 'application/json',
    'x-service-key': AI_SERVICE_KEY,
    ...extra,
  };
}

/* ── Health check ─────────────────────────────────────────────────────────── */

router.get('/health', async (req, res) => {
  try {
    const r = await fetch(`${AI_SERVICE_URL}/health`);
    const data = await r.json();
    res.json({ node: 'ok', python_ai: data });
  } catch (err) {
    res.status(503).json({ node: 'ok', python_ai: 'unreachable', error: err.message });
  }
});

/* ── Provider list ────────────────────────────────────────────────────────── */

router.get('/providers', async (req, res) => {
  try {
    const r = await fetch(`${AI_SERVICE_URL}/providers`, {
      headers: aiHeaders(),
    });
    const data = await r.json();
    res.json(data);
  } catch (err) {
    res.status(503).json({ error: 'AI service unreachable', detail: err.message });
  }
});

/* ── Streaming chat ───────────────────────────────────────────────────────── */

router.post('/chat', requireAuth, async (req, res) => {
  try {
    res.setHeader('Content-Type', 'text/event-stream');
    res.setHeader('Cache-Control', 'no-cache');
    res.setHeader('X-Accel-Buffering', 'no');
    res.setHeader('Connection', 'keep-alive');

    const aiRes = await fetch(`${AI_SERVICE_URL}/chat`, {
      method: 'POST',
      headers: aiHeaders(),
      body: JSON.stringify(req.body),
    });

    if (!aiRes.ok) {
      const err = await aiRes.json().catch(() => ({}));
      res.write(`data: [ERROR] ${err.detail || 'AI service error'}\n\n`);
      return res.end();
    }

    // Pipe SSE stream from Python → client
    aiRes.body.on('data', chunk => res.write(chunk));
    aiRes.body.on('end', () => res.end());
    aiRes.body.on('error', err => {
      console.error('AI stream error:', err);
      res.end();
    });

    req.on('close', () => aiRes.body.destroy());
  } catch (err) {
    console.error('Chat proxy error:', err);
    res.write(`data: [ERROR] ${err.message}\n\n`);
    res.end();
  }
});

/* ── Career roadmap ───────────────────────────────────────────────────────── */

router.post('/roadmap', requireAuth, async (req, res) => {
  try {
    const r = await fetch(`${AI_SERVICE_URL}/roadmap`, {
      method: 'POST',
      headers: aiHeaders(),
      body: JSON.stringify(req.body),
    });
    const data = await r.json();
    if (!r.ok) return res.status(r.status).json(data);
    res.json(data);
  } catch (err) {
    res.status(503).json({ error: 'AI service unreachable', detail: err.message });
  }
});

/* ── File ingest (RAG) ────────────────────────────────────────────────────── */

router.post('/ingest', requireAuth, upload.single('file'), async (req, res) => {
  if (!req.file) return res.status(400).json({ error: 'No file uploaded.' });

  const collectionName = req.body.collection_name
    || `user_${req.userId}_docs`;

  try {
    const form = new FormData();
    form.append('file', req.file.buffer, {
      filename: req.file.originalname,
      contentType: req.file.mimetype,
    });
    form.append('collection_name', collectionName);

    const r = await fetch(`${AI_SERVICE_URL}/ingest`, {
      method: 'POST',
      headers: { 'x-service-key': AI_SERVICE_KEY, ...form.getHeaders() },
      body: form,
    });

    const data = await r.json();
    if (!r.ok) return res.status(r.status).json(data);
    res.json(data);
  } catch (err) {
    res.status(503).json({ error: 'AI service unreachable', detail: err.message });
  }
});

/* ── RAG query ────────────────────────────────────────────────────────────── */

router.post('/rag/query', requireAuth, async (req, res) => {
  const collectionName = req.body.collection_name || `user_${req.userId}_docs`;
  try {
    const r = await fetch(`${AI_SERVICE_URL}/rag/query`, {
      method: 'POST',
      headers: aiHeaders(),
      body: JSON.stringify({ ...req.body, collection_name: collectionName }),
    });
    const data = await r.json();
    res.status(r.ok ? 200 : r.status).json(data);
  } catch (err) {
    res.status(503).json({ error: 'AI service unreachable' });
  }
});

/* ── Safety check ─────────────────────────────────────────────────────────── */

router.post('/safety', async (req, res) => {
  try {
    const r = await fetch(`${AI_SERVICE_URL}/safety/check`, {
      method: 'POST',
      headers: aiHeaders(),
      body: JSON.stringify({ text: req.body.text }),
    });
    const data = await r.json();
    res.json(data);
  } catch (err) {
    // Fail open — don't block users if safety service is down
    res.json({ is_safe: true, flagged_categories: [] });
  }
});

/* ── Image generation (HuggingFace Inference API — free) ──────────────────── */

router.get('/image', requireAuth, async (req, res) => {
  const prompt = (req.query.prompt || '').trim();
  if (!prompt) return res.status(400).json({ error: 'prompt required' });

  const HF_TOKEN = process.env.HF_TOKEN || '';
  const model    = 'stabilityai/stable-diffusion-2-1';
  const url      = `https://api-inference.huggingface.co/models/${model}`;

  const headers = {
    'Authorization':    HF_TOKEN ? `Bearer ${HF_TOKEN}` : '',
    'Content-Type':     'application/json',
    'x-wait-for-model': 'true',
  };
  const body = JSON.stringify({ inputs: prompt, parameters: { num_inference_steps: 20 } });

  // Retry up to 3 times (model may be loading)
  for (let attempt = 1; attempt <= 3; attempt++) {
    try {
      const r = await fetch(url, { method: 'POST', headers, body });

      if (r.status === 503) {
        const txt = await r.text().catch(() => '');
        console.log(`HF attempt ${attempt}/3 — model loading:`, txt.slice(0, 120));
        if (attempt < 3) { await new Promise(ok => setTimeout(ok, 8000)); continue; }
        return res.status(503).json({ error: 'Model is loading, try again in 30s' });
      }

      if (!r.ok) {
        const txt = await r.text().catch(() => '');
        console.error('HuggingFace error:', r.status, txt);
        return res.status(r.status).json({ error: 'Image generation failed', detail: txt });
      }

      const ct = r.headers.get('content-type') || 'image/jpeg';
      res.setHeader('Content-Type', ct);
      res.setHeader('Cache-Control', 'public, max-age=3600');
      return r.body.pipe(res);
    } catch (err) {
      if (attempt === 3) return res.status(503).json({ error: 'Image service unreachable', detail: err.message });
      await new Promise(ok => setTimeout(ok, 5000));
    }
  }
});

module.exports = router;
