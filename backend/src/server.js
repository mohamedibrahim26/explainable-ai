require('dotenv').config();
const app    = require('./app');
const prisma = require('./lib/prisma');

const PORT = parseInt(process.env.PORT || '3001', 10);

async function main() {
  /* ── Test DB connection ── */
  try {
    await prisma.$connect();
    console.log('✓ Database connected (SQLite)');
  } catch (err) {
    console.error('\n✗ Database connection failed:', err.message);
    console.error('\nTroubleshooting:');
    console.error('  1. Check DATABASE_URL in your .env file (should be a "file:" path)');
    console.error('  2. Run: npx prisma migrate dev --name init  (to create the database)\n');
    process.exit(1);
  }

  app.listen(PORT, () => {
    console.log(`\n🌟 Orion AI Backend running at http://localhost:${PORT}`);
    console.log(`   Health:       http://localhost:${PORT}/health`);
    console.log(`   Prisma Studio: npm run db:studio\n`);
  });

  /* ── Graceful shutdown ── */
  const shutdown = async () => {
    console.log('\nShutting down...');
    await prisma.$disconnect();
    process.exit(0);
  };
  process.on('SIGINT',  shutdown);
  process.on('SIGTERM', shutdown);
}

main();
