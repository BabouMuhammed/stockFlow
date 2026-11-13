// Creates a fresh, clearly named loopback test database. Never resets any database.
import { resolve, dirname } from 'node:path';
import { spawnSync } from 'node:child_process';
import { randomBytes } from 'node:crypto';
import { PrismaClient } from '@prisma/client';
import { config } from 'dotenv';
const root = resolve(__dirname, '../../..');
config({ path: resolve(root, '.env'), quiet: true });
async function run() {
  const main = new URL(process.env.DATABASE_URL!);
  if (!['localhost', '127.0.0.1', '[::1]'].includes(main.hostname))
    throw new Error('Isolated tests require local PostgreSQL; remote databases are refused');
  const target = new URL(main);
  target.pathname = '/stockflow_test_purchasing_' + randomBytes(6).toString('hex');
  target.searchParams.delete('schema');
  const adminUrl = new URL(main);
  adminUrl.pathname = '/postgres';
  adminUrl.searchParams.delete('schema');
  const admin = new PrismaClient({ datasourceUrl: adminUrl.toString() });
  try {
    await admin.$executeRawUnsafe('CREATE DATABASE "' + target.pathname.slice(1) + '"');
  } finally {
    await admin.$disconnect();
  }
  console.log('Created isolated loopback test database:', target.pathname.slice(1));
  const api = resolve(root, 'apps/api');
  const vitest = resolve(dirname(require.resolve('vitest/package.json')), 'vitest.mjs');
  const child = spawnSync(process.execPath, [vitest, 'run'], {
    cwd: api,
    // A deployment-oriented local .env must not turn disposable test seeding into production.
    env: { ...process.env, NODE_ENV: 'test', TEST_DATABASE_URL: target.toString() },
    stdio: 'inherit',
  });
  process.exitCode = child.status ?? 1;
}
run().catch((error: { code?: string; name: string }) => {
  console.error('Isolated test setup failed:', error.code ?? error.name);
  process.exitCode = 1;
});
