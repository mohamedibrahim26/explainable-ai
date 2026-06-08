const express = require('express');
const prisma   = require('../lib/prisma');
const { requireAuth } = require('../middleware/auth');

const router = express.Router();

/* ── Helpers ─────────────────────────────────────────────────── */

function isAdminEmail(email) {
  const list = (process.env.ADMIN_EMAILS || '')
    .split(',')
    .map(e => e.trim().toLowerCase())
    .filter(Boolean);
  return list.includes((email || '').toLowerCase());
}

function requireAdmin(req, res, next) {
  if (!isAdminEmail(req.userEmail)) {
    return res.status(403).json({ error: 'Admin access required.', code: 'NOT_ADMIN' });
  }
  next();
}

/** Group [{createdAt}] items into daily bucket counts for the last `days` days */
function dailyCounts(items, days = 7) {
  const buckets = {};
  const labels  = [];
  for (let i = days - 1; i >= 0; i--) {
    const d = new Date();
    d.setHours(0, 0, 0, 0);
    d.setDate(d.getDate() - i);
    const key = d.toISOString().split('T')[0];
    buckets[key] = 0;
    labels.push(d.toLocaleDateString('en-US', { weekday: 'short', month: 'short', day: 'numeric' }));
  }
  items.forEach(item => {
    const key = new Date(item.createdAt).toISOString().split('T')[0];
    if (Object.prototype.hasOwnProperty.call(buckets, key)) buckets[key]++;
  });
  return { labels, counts: Object.values(buckets) };
}

/* ── GET /api/admin/check ─────────────────────────────────────── */
router.get('/check', requireAuth, (req, res) => {
  res.json({ isAdmin: isAdminEmail(req.userEmail) });
});

/* ── GET /api/admin/overview ─────────────────────────────────── */
router.get('/overview', requireAuth, requireAdmin, async (req, res) => {
  try {
    const now       = new Date();
    const todayStart = new Date(now);
    todayStart.setHours(0, 0, 0, 0);

    const weekStart = new Date(todayStart);
    weekStart.setDate(weekStart.getDate() - 7);

    const [
      totalUsers, todayUsers, weekUsers,
      totalConvs, todayConvs,
      totalMsgs,  todayMsgs,
      userDates,  msgDates,
    ] = await Promise.all([
      prisma.user.count(),
      prisma.user.count({ where: { createdAt: { gte: todayStart } } }),
      prisma.user.count({ where: { createdAt: { gte: weekStart  } } }),
      prisma.conversation.count(),
      prisma.conversation.count({ where: { createdAt: { gte: todayStart } } }),
      prisma.message.count(),
      prisma.message.count({ where: { createdAt: { gte: todayStart } } }),
      prisma.user.findMany({
        where: { createdAt: { gte: weekStart } },
        select: { createdAt: true },
      }),
      prisma.message.findMany({
        where: { createdAt: { gte: weekStart } },
        select: { createdAt: true },
      }),
    ]);

    const userChart = dailyCounts(userDates);
    const msgChart  = dailyCounts(msgDates);

    res.json({
      users:    { total: totalUsers, today: todayUsers, week: weekUsers },
      convs:    { total: totalConvs, today: todayConvs },
      messages: { total: totalMsgs,  today: todayMsgs  },
      charts: {
        labels:    userChart.labels,
        userCounts: userChart.counts,
        msgCounts:  msgChart.counts,
      },
      system: {
        uptime:      Math.floor(process.uptime()),
        memoryMB:    Math.round(process.memoryUsage().heapUsed / 1024 / 1024),
        rssMB:       Math.round(process.memoryUsage().rss      / 1024 / 1024),
        nodeVersion: process.version,
      },
    });
  } catch (err) {
    console.error('Admin overview error:', err);
    res.status(500).json({ error: 'Server error.' });
  }
});

/* ── GET /api/admin/users?skip=0&take=15 ────────────────────── */
router.get('/users', requireAuth, requireAdmin, async (req, res) => {
  try {
    const skip = Math.max(0, parseInt(req.query.skip || '0', 10));
    const take = Math.min(50, parseInt(req.query.take || '15', 10));

    const [users, total] = await Promise.all([
      prisma.user.findMany({
        orderBy: { createdAt: 'desc' },
        skip,
        take,
        select: {
          id:        true,
          name:      true,
          email:     true,
          createdAt: true,
          _count:    { select: { conversations: true } },
        },
      }),
      prisma.user.count(),
    ]);

    res.json({ users, total });
  } catch (err) {
    console.error('Admin users error:', err);
    res.status(500).json({ error: 'Server error.' });
  }
});

/* ── GET /api/admin/conversations?skip=0&take=15 ─────────────── */
router.get('/conversations', requireAuth, requireAdmin, async (req, res) => {
  try {
    const skip = Math.max(0, parseInt(req.query.skip || '0', 10));
    const take = Math.min(50, parseInt(req.query.take || '15', 10));

    const [convs, total] = await Promise.all([
      prisma.conversation.findMany({
        orderBy:  { updatedAt: 'desc' },
        skip,
        take,
        include: {
          user:   { select: { name: true, email: true } },
          _count: { select: { messages: true } },
        },
      }),
      prisma.conversation.count(),
    ]);

    res.json({ conversations: convs, total });
  } catch (err) {
    console.error('Admin conversations error:', err);
    res.status(500).json({ error: 'Server error.' });
  }
});

module.exports = router;
