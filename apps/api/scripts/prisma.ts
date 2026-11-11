import { spawnSync } from 'node:child_process';
import { resolve } from 'node:path';
import { config } from 'dotenv';

// Prisma runs from the API workspace; the shared environment lives at the repo root.
// Keep explicitly supplied process environment variables authoritative.
config({ path: resolve(__dirname, '../../../.env') });
const child = spawnSync(
  process.execPath,
  [require.resolve('prisma/build/index.js'), ...process.argv.slice(2)],
  {
    stdio: 'inherit',
  },
);
if (child.error) console.error('Could not start Prisma:', child.error.message);
process.exit(child.status ?? 1);
