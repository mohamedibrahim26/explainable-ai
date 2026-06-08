const express = require('express');
const bcrypt  = require('bcryptjs');
const jwt     = require('jsonwebtoken');
const prisma  = require('../lib/prisma');
const { requireAuth } = require('../middleware/auth');

const router = express.Router();

/* ── Helpers ── */
function issueTokens(userId, email) {
  const accessToken = jwt.sign(
    { userId, email },
    process.env.JWT_SECRET,
    { expiresIn: '15m' }
  );
  const refreshToken = jwt.sign(
    { userId, email },
    process.env.JWT_REFRESH_SECRET,
    { expiresIn: '30d' }
  );
  return { accessToken, refreshToken };
}

/* ── POST /api/auth/signup ── */
router.post('/signup', async (req, res) => {
  try {
    const { email, password, name } = req.body;

    if (!email || !password)
      return res.status(400).json({ error: 'Email and password are required.' });

    if (password.length < 6)
      return res.status(400).json({ error: 'Password must be at least 6 characters.' });

    if (!/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(email))
      return res.status(400).json({ error: 'Invalid email format.' });

    const exists = await prisma.user.findUnique({ where: { email: email.toLowerCase() } });
    if (exists)
      return res.status(409).json({ error: 'An account with this email already exists.' });

    const passwordHash = await bcrypt.hash(password, 12);
    const user = await prisma.user.create({
      data: {
        email:        email.toLowerCase(),
        passwordHash,
        name:         (name || email.split('@')[0]).slice(0, 60),
      },
    });

    const tokens = issueTokens(user.id, user.email);
    res.status(201).json({
      user:   { id: user.id, email: user.email, name: user.name },
      ...tokens,
    });
  } catch (err) {
    console.error('Signup error:', err);
    res.status(500).json({ error: 'Server error during signup.' });
  }
});

/* ── POST /api/auth/login ── */
router.post('/login', async (req, res) => {
  try {
    const { email, password } = req.body;

    if (!email || !password)
      return res.status(400).json({ error: 'Email and password are required.' });

    const user = await prisma.user.findUnique({ where: { email: email.toLowerCase() } });
    if (!user)
      return res.status(401).json({ error: 'Invalid email or password.' });

    const valid = await bcrypt.compare(password, user.passwordHash);
    if (!valid)
      return res.status(401).json({ error: 'Invalid email or password.' });

    const tokens = issueTokens(user.id, user.email);
    res.json({
      user:   { id: user.id, email: user.email, name: user.name },
      ...tokens,
    });
  } catch (err) {
    console.error('Login error:', err);
    res.status(500).json({ error: 'Server error during login.' });
  }
});

/* ── POST /api/auth/refresh ── */
router.post('/refresh', async (req, res) => {
  try {
    const { refreshToken } = req.body;
    if (!refreshToken)
      return res.status(400).json({ error: 'Refresh token required.' });

    const payload = jwt.verify(refreshToken, process.env.JWT_REFRESH_SECRET);
    const user    = await prisma.user.findUnique({ where: { id: payload.userId } });
    if (!user)
      return res.status(401).json({ error: 'User not found.' });

    const tokens = issueTokens(user.id, user.email);
    res.json(tokens);
  } catch {
    res.status(401).json({ error: 'Invalid or expired refresh token.' });
  }
});

/* ── GET /api/auth/me ── */
router.get('/me', requireAuth, async (req, res) => {
  try {
    const user = await prisma.user.findUnique({
      where:  { id: req.userId },
      select: { id: true, email: true, name: true, createdAt: true },
    });
    if (!user) return res.status(404).json({ error: 'User not found.' });
    res.json({ user });
  } catch {
    res.status(500).json({ error: 'Server error.' });
  }
});

module.exports = router;
