import { beforeAll, describe, expect, it, vi } from 'vitest';
import request from 'supertest';
import express from 'express';
import type { PrismaClient } from '@prisma/client';
import { randomUUID } from 'node:crypto';
import { mkdtemp, writeFile, rm } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { envSchema, listenHost, readEnv } from '../config/env';
import { configureProxy } from '../config/proxy';
import { checkImageStorage, imageStorageFromEnv } from '../config/storage';
import { createApp } from '../app';
import { hashPassword } from '../security/password';
import { tokenHash } from '../security/session';

const origin = 'https://stockflow-demo.example.com';
const production = {
  NODE_ENV: 'production',
  DATABASE_URL: 'postgresql://audit.invalid/demo',
  WEB_ORIGIN: origin,
  TRUSTED_PROXY_CIDRS: '10.20.30.0/24',
};

describe('production settings', () => {
  it('requires explicit HTTPS origins and proxy boundaries; defaults to disabled images', () => {
    expect(envSchema.parse(production)).toMatchObject({
      NODE_ENV: 'production',
      PORT: 5000,
      WEB_ORIGIN: origin,
      IMAGE_STORAGE: 'disabled',
      TRUSTED_PROXY_CIDRS: ['10.20.30.0/24'],
    });
    expect(envSchema.parse({ ...production, PORT: '10000' }).PORT).toBe(10000);
    expect(listenHost('production')).toBe('0.0.0.0');
    expect(listenHost('development')).toBe('127.0.0.1');
    expect(listenHost('test')).toBe('127.0.0.1');
    expect(envSchema.parse({ DATABASE_URL: production.DATABASE_URL })).toMatchObject({
      WEB_ORIGIN: 'http://localhost:5173',
      TRUSTED_PROXY_CIDRS: [],
      IMAGE_STORAGE: 'local',
    });
  });
  it.each([
    undefined,
    'http://stockflow.example.com',
    'http://localhost:5173',
    'https://localhost:5173',
    'https://127.0.0.2',
    'https://10.0.0.1',
    '*',
    'https://*.vercel.app',
    origin + '/',
    origin + '/pos',
    origin + '?x=1',
    'https://user:password@stockflow.example.com',
    'null',
    'https://stockflow.local',
  ])('rejects production origin %s', (value) => {
    expect(envSchema.safeParse({ ...production, WEB_ORIGIN: value }).success).toBe(false);
  });
  it.each(['', '*', 'true', '1', '0.0.0.0/0', '::/0', '10.0.0.0/33', 'loopback', '10.20.30.1,'])(
    'rejects unsafe proxy configuration %s',
    (value) => {
      expect(envSchema.safeParse({ ...production, TRUSTED_PROXY_CIDRS: value }).success).toBe(
        false,
      );
    },
  );
  it('validates the complete production allowlist and keeps local configuration separate', () => {
    expect(
      envSchema.safeParse({ ...production, WEB_ORIGINS: origin + ',https://approved.example.com' })
        .success,
    ).toBe(true);
    expect(
      envSchema.safeParse({ ...production, WEB_ORIGINS: origin + ',http://localhost:5173' })
        .success,
    ).toBe(false);
    expect(
      envSchema.safeParse({ ...production, WEB_ORIGINS: 'https://other.example.com' }).success,
    ).toBe(false);
    expect(envSchema.safeParse({ ...production, NODE_ENV: 'development' }).success).toBe(false);
    expect(envSchema.safeParse({ ...production, IMAGE_STORAGE: 'local' }).success).toBe(false);
    expect(envSchema.safeParse({ ...production, IMAGE_STORAGE: 'persistent' }).success).toBe(false);
    expect(
      envSchema.safeParse({
        ...production,
        IMAGE_STORAGE: 'persistent',
        UPLOAD_DIR: 'relative/uploads',
      }).success,
    ).toBe(false);
  });
  it('reports configuration keys without leaking values', () => {
    const secret = 'postgresql://user:secret-password@audit.invalid/demo';
    expect(() => readEnv({ ...production, DATABASE_URL: secret, WEB_ORIGIN: 'invalid' })).toThrow(
      'WEB_ORIGIN',
    );
    try {
      readEnv({ ...production, DATABASE_URL: secret, WEB_ORIGIN: 'invalid' });
    } catch (error) {
      expect(String(error)).not.toContain(secret);
      expect(String(error)).not.toContain('secret-password');
    }
  });
});

describe('proxy trust', () => {
  const probe = (cidrs: string[]) => {
    const app = express();
    configureProxy(app, cidrs);
    app.get('/', (req, res) => res.json({ ip: req.ip, secure: req.secure, host: req.hostname }));
    return app;
  };
  it('ignores arbitrary forwarded headers from untrusted peers', async () => {
    const response = await request(probe(['10.20.30.0/24']))
      .get('/')
      .set('X-Forwarded-For', '198.51.100.10')
      .set('X-Forwarded-Proto', 'https')
      .set('X-Forwarded-Host', 'attacker.example');
    expect(response.body.secure).toBe(false);
    expect(response.body.ip).not.toBe('198.51.100.10');
    expect(response.body.host).not.toBe('attacker.example');
  });
  it('walks the chain from the trusted socket and stops at the first untrusted address', async () => {
    const app = probe(['127.0.0.1/32', '::1/128', '10.20.30.0/24']);
    const response = await request(app)
      .get('/')
      .set('X-Forwarded-For', '192.0.2.99, 198.51.100.10, 10.20.30.1')
      .set('X-Forwarded-Proto', 'https');
    expect(response.body).toMatchObject({ ip: '198.51.100.10', secure: true });
    const malformed = await request(app).get('/').set('X-Forwarded-Proto', 'https,http');
    expect(malformed.body.secure).toBe(false);
  });
  it('does not trust headers in local development by default', async () => {
    expect((await request(probe([])).get('/').set('X-Forwarded-Proto', 'https')).body.secure).toBe(
      false,
    );
  });
});

// An in-memory Prisma-shaped double exercises HTTP/session/CSRF behavior without connecting to PostgreSQL.
function authDatabase(passwordHash: string) {
  const business = {
    id: randomUUID(),
    name: 'Production protocol test',
    currency: 'GMD',
    isDemo: false,
  };
  const user = {
    id: randomUUID(),
    businessId: business.id,
    name: 'Owner',
    email: 'owner@example.test',
    role: 'OWNER',
    isActive: true,
    passwordHash,
    business,
  };
  const sessions: { id: string; tokenHash: string; expiresAt: Date; revokedAt?: Date }[] = [];
  const methods = {
    business: { create: vi.fn(async () => business) },
    user: {
      findFirst: vi.fn(async () => null),
      create: vi.fn(async () => user),
      findMany: vi.fn(async () => [user]),
    },
    userSession: {
      create: vi.fn(async ({ data }) => {
        const s = { id: randomUUID(), ...data };
        sessions.push(s);
        return s;
      }),
      findUnique: vi.fn(async ({ where }) => {
        const s = sessions.find((s) => s.tokenHash === where.tokenHash);
        return s ? { ...s, user, business } : null;
      }),
      updateMany: vi.fn(async () => ({ count: 0 })),
      update: vi.fn(async ({ where, data }) =>
        Object.assign(
          sessions.find((s) => s.id === where.id)!,
          data,
        ),
      ),
    },
    auditLog: { create: vi.fn(async () => ({})) },
    $executeRaw: vi.fn(async () => 1),
  };
  const db = {
    ...methods,
    $transaction: vi.fn(async (fn) => fn(methods)),
  } as unknown as PrismaClient;
  return { db, methods, sessions };
}

describe('HTTPS authentication, CORS and image safety without database writes', () => {
  let passwordHash: string;
  beforeAll(async () => {
    passwordHash = await hashPassword('Test-only-long-password');
  });
  const makeApp = (db: PrismaClient) =>
    createApp({
      db,
      webOrigin: origin,
      cookieSecure: true,
      imageStorage: { mode: 'disabled' },
      checkDatabase: async () => {},
    });
  it('allows only the explicitly approved production CORS origin', async () => {
    const app = makeApp(authDatabase(passwordHash).db);
    const response = await request(app)
      .options('/api/v1/auth/login')
      .set('Origin', origin)
      .set('Access-Control-Request-Method', 'POST')
      .set('Access-Control-Request-Headers', 'content-type,x-csrf-token')
      .expect(204);
    expect(response.headers['access-control-allow-origin']).toBe(origin);
    expect(response.headers['access-control-allow-credentials']).toBe('true');
    expect(response.headers.vary).toContain('Origin');
    for (const other of [
      'http://localhost:5173',
      'https://stockflow-demo.example.com.attacker.test',
      'https://unapproved.vercel.app',
      'null',
    ]) {
      expect(
        (await request(app).get('/api/v1/health').set('Origin', other)).headers[
          'access-control-allow-origin'
        ],
      ).toBeUndefined();
      await request(app).post('/api/v1/auth/login').set('Origin', other).send({}).expect(403);
    }
  });
  it('sets strict HTTPS session cookies, restores sessions, and requires Origin + CSRF for logout', async () => {
    const { db, sessions } = authDatabase(passwordHash),
      app = makeApp(db);
    const login = await request(app)
      .post('/api/v1/auth/login')
      .set('Origin', origin)
      .send({ email: 'owner@example.test', password: 'Test-only-long-password' })
      .expect(200);
    const setCookie = String(login.headers['set-cookie'][0]);
    for (const attribute of ['HttpOnly', 'Secure', 'SameSite=Strict', 'Path=/api/v1'])
      expect(setCookie).toContain(attribute);
    expect(setCookie).not.toContain('Domain=');
    const cookie = setCookie.split(';')[0],
      token = cookie.split('=')[1];
    expect(sessions[0].tokenHash).toBe(tokenHash(token));
    expect(sessions[0].tokenHash).not.toBe(token);
    await request(app).get('/api/v1/auth/session').set('Cookie', cookie).expect(200);
    await request(app)
      .post('/api/v1/auth/logout')
      .set('Cookie', cookie)
      .set('Origin', origin)
      .expect(403);
    await request(app)
      .post('/api/v1/auth/logout')
      .set('Cookie', cookie)
      .set('Origin', 'https://evil.example')
      .set('X-CSRF-Token', login.body.csrfToken)
      .expect(403);
    await request(app)
      .post('/api/v1/auth/logout')
      .set('Cookie', cookie)
      .set('Origin', origin)
      .set('X-CSRF-Token', login.body.csrfToken)
      .expect(204);
    await request(app).get('/api/v1/auth/session').set('Cookie', cookie).expect(401);
  });
  it('registers over the approved origin and fails disabled image uploads explicitly without touching products', async () => {
    const { db, methods } = authDatabase(passwordHash),
      app = makeApp(db);
    const registered = await request(app)
      .post('/api/v1/auth/register')
      .set('Origin', origin)
      .send({
        businessName: 'Demo',
        name: 'Owner',
        phone: '+220 7000000',
        email: 'new@example.test',
        password: 'Test-only-long-password',
        passwordConfirmation: 'Test-only-long-password',
      })
      .expect(201);
    expect(String(registered.headers['set-cookie'][0])).toContain('Secure');
    const cookie = String(registered.headers['set-cookie'][0]).split(';')[0];
    const response = await request(app)
      .post('/api/v1/products/' + randomUUID() + '/image')
      .set('Cookie', cookie)
      .set('Origin', origin)
      .set('X-CSRF-Token', registered.body.csrfToken)
      .set('Content-Type', 'image/png')
      .send(Buffer.from('not saved'))
      .expect(503);
    expect(response.body.code).toBe('IMAGE_STORAGE_DISABLED');
    expect(methods.auditLog.create).toHaveBeenCalledTimes(1);
  });
  it('requires an existing writable storage directory with its provisioned marker', async () => {
    const directory = await mkdtemp(join(tmpdir(), 'stockflow-storage-'));
    const storage = imageStorageFromEnv({ IMAGE_STORAGE: 'persistent', UPLOAD_DIR: directory });
    try {
      await expect(checkImageStorage(storage)).rejects.toMatchObject({ status: 503 });
      await writeFile(join(directory, '.stockflow-storage'), 'stockflow-persistent-v1\n');
      await expect(checkImageStorage(storage)).resolves.toBeUndefined();
      await rm(join(directory, '.stockflow-storage'));
      await expect(checkImageStorage(storage)).rejects.toMatchObject({ status: 503 });
      await expect(checkImageStorage({ mode: 'disabled' })).resolves.toBeUndefined();
    } finally {
      await rm(directory, { recursive: true, force: true });
    }
  });
});
