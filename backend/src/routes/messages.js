const express = require('express');
const prisma  = require('../lib/prisma');
const { requireAuth } = require('../middleware/auth');

const router = express.Router({ mergeParams: true });
router.use(requireAuth);

/* ── GET /api/conversations/:id/messages ── */
router.get('/', async (req, res) => {
  try {
    const conv = await prisma.conversation.findFirst({
      where: { id: req.params.id, userId: req.userId },
    });
    if (!conv) return res.status(404).json({ error: 'Conversation not found.' });

    const messages = await prisma.message.findMany({
      where:   { conversationId: req.params.id },
      orderBy: { createdAt: 'asc' },
    });
    res.json({ messages });
  } catch (err) {
    console.error(err);
    res.status(500).json({ error: 'Server error.' });
  }
});

/* ── POST /api/conversations/:id/messages
   Body: { messages: [{role, text, apiText?, attachments?}] }
   Saves a batch (user + AI) in one request.
── */
router.post('/', async (req, res) => {
  try {
    const conv = await prisma.conversation.findFirst({
      where: { id: req.params.id, userId: req.userId },
    });
    if (!conv) return res.status(404).json({ error: 'Conversation not found.' });

    const { messages } = req.body;
    if (!Array.isArray(messages) || messages.length === 0)
      return res.status(400).json({ error: 'messages array required.' });

    const created = await prisma.$transaction(
      messages.map(m =>
        prisma.message.create({
          data: {
            conversationId: req.params.id,
            role:           m.role === 'ai' ? 'ai' : 'user',
            text:           String(m.text || ''),
            apiText:        m.apiText ? String(m.apiText) : null,
            attachments:    Array.isArray(m.attachments) ? m.attachments : [],
          },
        })
      )
    );

    // Bump conversation updatedAt so it sorts to top
    await prisma.conversation.update({
      where: { id: req.params.id },
      data:  { updatedAt: new Date() },
    });

    res.status(201).json({ messages: created });
  } catch (err) {
    console.error(err);
    res.status(500).json({ error: 'Server error.' });
  }
});

module.exports = router;
