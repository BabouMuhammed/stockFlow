import { describe, expect, it, vi } from 'vitest';
import request from 'supertest';
import type { PrismaClient } from '@prisma/client';
import { createApp } from '../app';
import { envSchema } from '../config/env';

const configuration = {
  NODE_ENV: 'production',
  DEPLOYMENT_MODE: 'bootstrap',
  DATABASE_URL: 'postgresql://unused.invalid/never_connected',
};
describe('backend-first bootstrap deployment without database writes', () => {
  it('permits infrastructure startup without frontend origins or proxy trust', () => {
    expect(envSchema.parse(configuration)).toMatchObject({
      DEPLOYMENT_MODE: 'bootstrap',
      IMAGE_STORAGE: 'disabled',
      TRUSTED_PROXY_CIDRS: [],
    });
  });
  it.each([
    { NODE_ENV: 'development' },
    { WEB_ORIGIN: 'https://demo.example.com' },
    { WEB_ORIGINS: 'https://demo.example.com' },
    { TRUSTED_PROXY_CIDRS: '127.0.0.1/32' },
    { IMAGE_STORAGE: 'local' },
    { IMAGE_STORAGE: 'persistent', UPLOAD_DIR: '/var/data/uploads' },
  ])('rejects mixed bootstrap/application settings: %o', (extra) => {
    expect(envSchema.safeParse({ ...configuration, ...extra }).success).toBe(false);
  });
  it('still requires real application origin and proxy configuration when enabling app mode', () => {
    expect(envSchema.safeParse({ ...configuration, DEPLOYMENT_MODE: 'app' }).success).toBe(false);
    expect(
      envSchema.safeParse({
        ...configuration,
        DEPLOYMENT_MODE: 'app',
        WEB_ORIGIN: 'https://demo.example.com',
        TRUSTED_PROXY_CIDRS: '10.20.30.0/24',
      }).success,
    ).toBe(true);
    expect(
      envSchema.safeParse({
        ...configuration,
        DEPLOYMENT_MODE: 'app',
        WEB_ORIGIN: 'https://demo.example.com',
        PROXY_MODE: 'none',
      }).success,
    ).toBe(true);
  });
  it('exposes liveness and infrastructure readiness without claiming the application is enabled', async () => {
    const checkDatabase = vi.fn(async () => {});
    const app = createApp({
      webOrigin: 'https://bootstrap.invalid',
      bootstrap: true,
      checkDatabase,
    });
    const live = await request(app).get('/api/v1/health').expect(200);
    expect(live.body).toMatchObject({ mode: 'bootstrap', applicationReady: false });
    expect(checkDatabase).not.toHaveBeenCalled();
    const ready = await request(app).get('/api/v1/health/ready').expect(200);
    expect(ready.body).toMatchObject({
      status: 'ready',
      database: 'connected',
      applicationReady: false,
    });
    expect(checkDatabase).toHaveBeenCalledOnce();
    const offline = createApp({
      webOrigin: 'https://bootstrap.invalid',
      bootstrap: true,
      checkDatabase: async () => {
        throw new Error('offline');
      },
    });
    await request(offline).get('/api/v1/health/ready').expect(503);
  });
  it('does not mount authentication or business routes, set cookies or grant browser CORS', async () => {
    const db = new Proxy(
      {},
      {
        get() {
          throw new Error('Business database methods must not be accessed');
        },
      },
    ) as PrismaClient;
    const app = createApp({
      db,
      webOrigin: 'https://bootstrap.invalid',
      bootstrap: true,
      checkDatabase: async () => {},
    });
    for (const path of [
      'auth/register',
      'auth/login',
      'auth/session',
      'auth/logout',
      'products',
      'inventory/receipts',
      'sales',
      'settings',
      'staff',
      'reports/summary',
      'customers',
      'expenses',
    ]) {
      for (const method of ['get', 'post'] as const) {
        const agent = request(app);
        const response = await agent[method]('/api/v1/' + path)
          .set('Origin', 'https://bootstrap.invalid')
          .send({});
        expect(response.status).toBe(503);
        expect(response.body.code).toBe('BOOTSTRAP_MODE');
        expect(response.headers['set-cookie']).toBeUndefined();
        expect(response.headers['access-control-allow-origin']).toBeUndefined();
      }
    }
    await request(app)
      .options('/api/v1/auth/login')
      .set('Origin', 'https://bootstrap.invalid')
      .set('Access-Control-Request-Method', 'POST')
      .expect(503);
  });
});
