const express        = require('express');
const prisma         = require('../lib/prisma');
const { requireAuth} = require('../middleware/auth');

const router = express.Router();
router.use(requireAuth);

/* ── GET /api/workspaces ── */
router.get('/', async (req, res) => {
  try {
    const workspaces = await prisma.workspace.findMany({
      where:   { userId: req.userId },
      orderBy: { createdAt: 'asc' },
      include: {
        projects: { orderBy: { createdAt: 'asc' } },
      },
    });
    res.json({ workspaces });
  } catch (err) {
    console.error(err);
    res.status(500).json({ error: 'Server error.' });
  }
});

/* ── POST /api/workspaces ── */
router.post('/', async (req, res) => {
  try {
    const { name, color = '#7C3AED' } = req.body;
    if (!name?.trim()) return res.status(400).json({ error: 'Name is required.' });
    const workspace = await prisma.workspace.create({
      data:    { name: name.trim().slice(0, 60), color, userId: req.userId },
      include: { projects: true },
    });
    res.status(201).json({ workspace });
  } catch (err) {
    console.error(err);
    res.status(500).json({ error: 'Server error.' });
  }
});

/* ── PATCH /api/workspaces/:id ── */
router.patch('/:id', async (req, res) => {
  try {
    const ws = await prisma.workspace.findFirst({
      where: { id: req.params.id, userId: req.userId },
    });
    if (!ws) return res.status(404).json({ error: 'Workspace not found.' });

    const { name, color } = req.body;
    const updated = await prisma.workspace.update({
      where:   { id: req.params.id },
      data:    {
        ...(name  !== undefined && { name: name.trim().slice(0, 60) }),
        ...(color !== undefined && { color }),
      },
      include: { projects: true },
    });
    res.json({ workspace: updated });
  } catch (err) {
    console.error(err);
    res.status(500).json({ error: 'Server error.' });
  }
});

/* ── DELETE /api/workspaces/:id ── */
router.delete('/:id', async (req, res) => {
  try {
    const ws = await prisma.workspace.findFirst({
      where: { id: req.params.id, userId: req.userId },
    });
    if (!ws) return res.status(404).json({ error: 'Workspace not found.' });

    // Orphan projects (don't delete them — conversations stay intact)
    await prisma.project.updateMany({
      where: { workspaceId: req.params.id },
      data:  { workspaceId: null },
    });
    await prisma.workspace.delete({ where: { id: req.params.id } });
    res.json({ success: true });
  } catch (err) {
    console.error(err);
    res.status(500).json({ error: 'Server error.' });
  }
});

module.exports = router;
