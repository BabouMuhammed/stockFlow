import { PrismaClient } from '@prisma/client';
import { randomBytes } from 'node:crypto';
import { spawn, spawnSync, type ChildProcess } from 'node:child_process';
import { mkdirSync, writeFileSync } from 'node:fs';
import { resolve } from 'node:path';
import { createServer } from 'node:net';
import { config } from 'dotenv';

const root = resolve(__dirname, '../../..');
config({ path: resolve(root, '.env'), quiet: true });
async function available(port: number) {
  await new Promise<void>((done, fail) => {
    const server = createServer();
    server.once('error', fail);
    server.listen(port, '127.0.0.1', () => server.close((error) => (error ? fail(error) : done())));
  });
}
async function run() {
  const main = new URL(process.env.DATABASE_URL!);
  if (
    process.env.NODE_ENV === 'production' ||
    !['localhost', '127.0.0.1', '[::1]'].includes(main.hostname)
  )
    throw new Error('LOCAL_ONLY');
  await available(5102);
  await available(5175);
  const target = new URL(main);
  target.pathname = '/stockflow_test_demo_' + randomBytes(6).toString('hex');
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
  const env: NodeJS.ProcessEnv = {
    ...process.env,
    DATABASE_URL: target.toString(),
    NODE_ENV: 'test',
    DEPLOYMENT_MODE: 'app',
    WEB_ORIGIN: 'http://127.0.0.1:5175',
    WEB_ORIGINS: 'http://127.0.0.1:5175',
    PORT: '5102',
    IMAGE_STORAGE: 'disabled',
    TRUSTED_PROXY_CIDRS: '',
    VITE_API_URL: '/api/v1',
  };
  delete env.UPLOAD_DIR;
  const migration = spawnSync(
    process.execPath,
    [
      require.resolve('prisma/build/index.js'),
      'migrate',
      'deploy',
      '--schema',
      resolve(root, 'apps/api/prisma/schema.prisma'),
    ],
    { env, stdio: 'pipe', windowsHide: true },
  );
  if (migration.status !== 0) throw new Error('ISOLATED_DEMO_MIGRATION_FAILED');
  mkdirSync(resolve(root, '.local'), { recursive: true });
  writeFileSync(
    resolve(root, '.local/purchasing-demo.json'),
    JSON.stringify(
      {
        database: target.pathname.slice(1),
        frontend: env.WEB_ORIGIN,
        createdAt: new Date().toISOString(),
      },
      null,
      2,
    ),
  );
  const children: ChildProcess[] = [];
  const stop = () => {
    for (const child of children) child.kill();
  };
  const api = spawn(process.execPath, [resolve(root, 'apps/api/dist/src/index.js')], {
    cwd: resolve(root, 'apps/api'),
    env,
    stdio: 'inherit',
    windowsHide: true,
  });
  children.push(api);
  const web = spawn(
    process.execPath,
    [
      resolve(root, 'node_modules/vite/bin/vite.js'),
      '--host',
      '127.0.0.1',
      '--port',
      '5175',
      '--strictPort',
    ],
    { cwd: resolve(root, 'apps/web'), env, stdio: 'inherit', windowsHide: true },
  );
  children.push(web);
  for (const child of children) {
    child.once('error', stop);
    child.once('exit', stop);
  }
  process.once('SIGINT', stop);
  process.once('SIGTERM', stop);
  console.log('ISOLATED LOCAL DEMO — enter illustrative data only. Image uploads are disabled.');
  console.log('Open http://127.0.0.1:5175/register and choose your own demo login.');
  console.log('Fresh demo database:', target.pathname.slice(1));
  console.log(
    'Each run creates a new database. Previous databases are retained. Your existing application database is untouched.',
  );
}
run().catch((error: { code?: string; message: string }) => {
  console.error('Local demo stopped:', error.code ?? error.message);
  process.exitCode = 1;
});
