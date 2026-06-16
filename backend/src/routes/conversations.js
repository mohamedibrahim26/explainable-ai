const express = require('express');
const prisma  = require('../lib/prisma');
const { requireAuth } = require('../middleware/auth');

const router = express.Router();
router.use(requireAuth);

/* ── GET /api/conversations ── */
router.get('/', async (req, res) => {
  try {
    const conversations = await prisma.conversation.findMany({
      where:   { userId: req.userId },
      orderBy: { updatedAt: 'desc' },
      select: {
        id: true, title: true, projectId: true, createdAt: true, updatedAt: true,
        _count: { select: { messages: true } },
      },
    });
    res.json({ conversations });
  } catch (err) {
    console.error(err);
    res.status(500).json({ error: 'Server error.' });
  }
});

/* ── POST /api/conversations ── */
router.post('/', async (req, res) => {
  try {
    const { title } = req.body;
    const conv = await prisma.conversation.create({
      data: { userId: req.userId, title: (title || 'New Chat').slice(0, 120) },
    });
    res.status(201).json({ conversation: conv });
  } catch (err) {
    console.error(err);
    res.status(500).json({ error: 'Server error.' });
  }
});

/* ── PATCH /api/conversations/:id ── */
router.patch('/:id', async (req, res) => {
  try {
    const { title, projectId } = req.body;
    const conv = await prisma.conversation.findFirst({
      where: { id: req.params.id, userId: req.userId },
    });
    if (!conv) return res.status(404).json({ error: 'Conversation not found.' });

    const updated = await prisma.conversation.update({
      where: { id: req.params.id },
      data:  {
        title:     (title || conv.title).slice(0, 120),
        updatedAt: new Date(),
        // projectId: null removes from project; undefined = no change
        ...(projectId !== undefined && { projectId: projectId || null }),
      },
    });
    res.json({ conversation: updated });
  } catch (err) {
    console.error(err);
    res.status(500).json({ error: 'Server error.' });
  }
});

/* ── DELETE /api/conversations/:id ── */
router.delete('/:id', async (req, res) => {
  try {
    const conv = await prisma.conversation.findFirst({
      where: { id: req.params.id, userId: req.userId },
    });
    if (!conv) return res.status(404).json({ error: 'Conversation not found.' });

    await prisma.conversation.delete({ where: { id: req.params.id } });
    res.json({ success: true });
  } catch (err) {
    console.error(err);
    res.status(500).json({ error: 'Server error.' });
  }
});

module.exports = router;
