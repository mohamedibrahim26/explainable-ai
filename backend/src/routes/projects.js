const express        = require('express');
const prisma         = require('../lib/prisma');
const { requireAuth} = require('../middleware/auth');

const router = express.Router();
router.use(requireAuth);

/* ── GET /api/projects ── */
router.get('/', async (req, res) => {
  try {
    const projects = await prisma.project.findMany({
      where:   { userId: req.userId },
      orderBy: { createdAt: 'asc' },
    });
    res.json({ projects });
  } catch (err) {
    console.error(err);
    res.status(500).json({ error: 'Server error.' });
  }
});

/* ── POST /api/projects ── */
router.post('/', async (req, res) => {
  try {
    const { name, color = '#7C3AED', icon = '📁', workspaceId } = req.body;
    if (!name?.trim()) return res.status(400).json({ error: 'Name is required.' });

    // Verify workspace belongs to user
    if (workspaceId) {
      const ws = await prisma.workspace.findFirst({
        where: { id: workspaceId, userId: req.userId },
      });
      if (!ws) return res.status(404).json({ error: 'Workspace not found.' });
    }

    const project = await prisma.project.create({
      data: {
        name:        name.trim().slice(0, 60),
        color,
        icon,
        workspaceId: workspaceId || null,
        userId:      req.userId,
      },
    });
    res.status(201).json({ project });
  } catch (err) {
    console.error(err);
    res.status(500).json({ error: 'Server error.' });
  }
});

/* ── PATCH /api/projects/:id ── */
router.patch('/:id', async (req, res) => {
  try {
    const proj = await prisma.project.findFirst({
      where: { id: req.params.id, userId: req.userId },
    });
    if (!proj) return res.status(404).json({ error: 'Project not found.' });

    const { name, color, icon, workspaceId } = req.body;
    const updated = await prisma.project.update({
      where: { id: req.params.id },
      data:  {
        ...(name        !== undefined && { name: name.trim().slice(0, 60) }),
        ...(color       !== undefined && { color }),
        ...(icon        !== undefined && { icon }),
        ...(workspaceId !== undefined && { workspaceId: workspaceId || null }),
      },
    });
    res.json({ project: updated });
  } catch (err) {
    console.error(err);
    res.status(500).json({ error: 'Server error.' });
  }
});

/* ── DELETE /api/projects/:id ── */
router.delete('/:id', async (req, res) => {
  try {
    const proj = await prisma.project.findFirst({
      where: { id: req.params.id, userId: req.userId },
    });
    if (!proj) return res.status(404).json({ error: 'Project not found.' });

    // Un-assign conversations (don't delete them)
    await prisma.conversation.updateMany({
      where: { projectId: req.params.id },
      data:  { projectId: null },
    });
    await prisma.project.delete({ where: { id: req.params.id } });
    res.json({ success: true });
  } catch (err) {
    console.error(err);
    res.status(500).json({ error: 'Server error.' });
  }
});

/* ── PATCH /api/projects/:id/conversations/:convId — assign conversation ── */
router.patch('/:id/conversations/:convId', async (req, res) => {
  try {
    const proj = await prisma.project.findFirst({
      where: { id: req.params.id, userId: req.userId },
    });
    if (!proj) return res.status(404).json({ error: 'Project not found.' });

    const conv = await prisma.conversation.findFirst({
      where: { id: req.params.convId, userId: req.userId },
    });
    if (!conv) return res.status(404).json({ error: 'Conversation not found.' });

    const updated = await prisma.conversation.update({
      where: { id: req.params.convId },
      data:  { projectId: req.params.id },
    });
    res.json({ conversation: updated });
  } catch (err) {
    console.error(err);
    res.status(500).json({ error: 'Server error.' });
  }
});

module.exports = router;
