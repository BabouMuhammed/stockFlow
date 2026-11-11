import { describe, expect, it } from 'vitest';
import request from 'supertest';
import { createApp } from '../app';
import { envSchema } from '../config/env';
import { can } from '../middleware/authorization';
import { assertDemoSeedAllowed } from '../../prisma/demo-policy';
const create = (ready = true) =>
  createApp({
    webOrigin: 'http://localhost:5173',
    checkDatabase: async () => {
      if (!ready) throw new Error('offline');
    },
  });
describe('environment validation', () => {
  it('requires PostgreSQL and validates port and environment', () => {
    expect(envSchema.safeParse({}).success).toBe(false);
    expect(envSchema.safeParse({ DATABASE_URL: 'https://example.com', PORT: 5000 }).success).toBe(
      false,
    );
    expect(
      envSchema.safeParse({ DATABASE_URL: 'postgresql://localhost/demo', PORT: 65536 }).success,
    ).toBe(false);
    expect(
      envSchema.safeParse({ DATABASE_URL: 'postgresql://localhost/demo', NODE_ENV: 'production' })
        .success,
    ).toBe(false);
    expect(envSchema.parse({ DATABASE_URL: 'postgresql://localhost/demo' }).PORT).toBe(5000);
    for (const WEB_ORIGIN of [
      'invalid-url',
      'https://untrusted.invalid',
      'http://localhost:5173/',
    ]) {
      expect(
        envSchema.safeParse({ DATABASE_URL: 'postgresql://localhost/demo', WEB_ORIGIN }).success,
      ).toBe(false);
    }
  });
});
describe('API foundation', () => {
  it('distinguishes liveness from readiness', async () => {
    await request(create(false)).get('/api/v1/health').expect(200, { status: 'ok', phase: 1 });
    await request(create()).get('/api/v1/health/ready').expect(200);
    const failed = await request(create(false)).get('/api/v1/health/ready').expect(503);
    expect(failed.body.code).toBe('NOT_READY');
  });
  it('disables business reads and writes without fabricated success', async () => {
    for (const path of [
      'auth/login',
      'products',
      'inventory/receipts',
      'sales',
      'reports/summary',
      'staff',
      'business',
    ]) {
      await request(create())
        .get('/api/v1/' + path)
        .expect(501);
      await request(create())
        .post('/api/v1/' + path)
        .send({})
        .expect(501);
    }
  });
  it('returns consistent errors for malformed JSON, oversized bodies and missing routes', async () => {
    await request(create())
      .post('/api/v1/sales')
      .set('Content-Type', 'application/json')
      .send('{')
      .expect(400);
    await request(create())
      .post('/api/v1/sales')
      .send({ value: 'x'.repeat(40000) })
      .expect(413);
    const missing = await request(create()).get('/missing').expect(404);
    expect(missing.body.code).toBe('NOT_FOUND');
  });
  it('restricts browser CORS to the configured frontend', async () => {
    const response = await request(create())
      .get('/api/v1/health')
      .set('Origin', 'https://untrusted.invalid');
    expect(response.headers['access-control-allow-origin']).toBeUndefined();
  });
});
describe('role policy foundation', () => {
  it('limits manager and cashier permissions', () => {
    expect(can('OWNER', 'settings')).toBe(true);
    expect(can('MANAGER', 'inventory')).toBe(true);
    expect(can('MANAGER', 'settings')).toBe(false);
    expect(can('CASHIER', 'checkout')).toBe(true);
    expect(can('CASHIER', 'reports')).toBe(false);
  });
});
describe('seed safety policy', () => {
  it('requires explicit local demo opt-in and rejects production or remote targets', () => {
    expect(() => assertDemoSeedAllowed({ DATABASE_URL: 'postgresql://localhost/demo' })).toThrow();
    expect(() =>
      assertDemoSeedAllowed({
        ALLOW_DEMO_SEED: 'true',
        DATABASE_URL: 'postgresql://remote.invalid/demo',
      }),
    ).toThrow();
    expect(() =>
      assertDemoSeedAllowed({
        ALLOW_DEMO_SEED: 'true',
        DATABASE_URL: 'postgresql://localhost/demo',
        NODE_ENV: 'production',
      }),
    ).toThrow();
    expect(() =>
      assertDemoSeedAllowed({
        ALLOW_DEMO_SEED: 'true',
        DATABASE_URL: 'postgresql://localhost/demo',
      }),
    ).not.toThrow();
  });
});
