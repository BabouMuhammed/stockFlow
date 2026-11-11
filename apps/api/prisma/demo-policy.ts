export const DEMO_BUSINESS_ID = '00000000-0000-4000-8000-000000000001';
export const DEMO_BRANCH_ID = '00000000-0000-4000-8000-000000000002';
export function assertDemoSeedAllowed(source: NodeJS.ProcessEnv) {
  if (source.ALLOW_DEMO_SEED !== 'true')
    throw new Error('Set ALLOW_DEMO_SEED=true explicitly for a disposable local demo database.');
  const url = new URL(source.DATABASE_URL ?? '');
  if (!['localhost', '127.0.0.1', '[::1]'].includes(url.hostname))
    throw new Error('Demo seeding requires a local PostgreSQL server.');
  if (source.NODE_ENV === 'production') throw new Error('Production seeding is forbidden.');
}
