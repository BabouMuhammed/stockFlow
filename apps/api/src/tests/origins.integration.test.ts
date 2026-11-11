import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import request from 'supertest';
import { PrismaClient } from '@prisma/client';
import { randomBytes, randomUUID } from 'node:crypto';
import { createApp } from '../app';
const url = process.env.TEST_DATABASE_URL;
const suite = url ? describe : describe.skip;
let db: PrismaClient, app: ReturnType<typeof createApp>;
suite('registration, cookies and CSRF from both local origins', () => {
  beforeAll(async () => {
    const target = new URL(url!);
    if (
      !['localhost', '127.0.0.1', '[::1]'].includes(target.hostname) ||
      !/^\/stockflow_test[a-z0-9_]*$/.test(target.pathname)
    )
      throw new Error('Separate local test database required');
    if (process.env.DATABASE_URL) {
      const main = new URL(process.env.DATABASE_URL);
      if (main.host === target.host && main.pathname === target.pathname)
        throw new Error('Test and application databases must differ');
    }
    db = new PrismaClient({ datasourceUrl: url });
    app = createApp({
      db,
      webOrigin: 'http://localhost:5173',
      checkDatabase: () => db.$queryRaw`SELECT 1`,
    });
  });
  afterAll(async () => {
    await db?.$disconnect();
  });
  it.each(['http://localhost:5173', 'http://127.0.0.1:5173'])(
    'registers, restores a session, enforces CSRF, logs out and logs in from %s',
    async (origin) => {
      const password = randomBytes(24).toString('hex'),
        email = randomUUID() + '@example.test';
      const registration = await request(app)
        .post('/api/v1/auth/register')
        .set('Origin', origin)
        .send({
          businessName: 'Origin verification',
          name: 'Test owner',
          email,
          phone: '+220 7000000',
          password,
          passwordConfirmation: password,
        })
        .expect(201);
      expect(registration.headers['access-control-allow-origin']).toBe(origin);
      const rawCookie = String(registration.headers['set-cookie'][0]),
        cookie = rawCookie.split(';')[0];
      expect(rawCookie).toContain('HttpOnly');
      expect(rawCookie).toContain('SameSite=Strict');
      expect(rawCookie).not.toContain('Domain=');
      await db.business.update({
        where: { id: registration.body.business.id },
        data: { isDemo: true },
      });
      const session = await request(app)
        .get('/api/v1/auth/session')
        .set('Origin', origin)
        .set('Cookie', cookie)
        .expect(200);
      expect(session.headers['access-control-allow-origin']).toBe(origin);
      expect(session.body.user.id).toBe(registration.body.user.id);
      const write = (path: string, source = origin, token = session.body.csrfToken) =>
        request(app)
          .post('/api/v1' + path)
          .set('Origin', source)
          .set('Cookie', cookie)
          .set('X-CSRF-Token', token);
      await write('/categories').send({ name: 'Verified origin' }).expect(201);
      await write('/categories', origin, 'invalid')
        .send({ name: 'Missing security token' })
        .expect(403);
      const denied = await write('/categories', 'https://untrusted.invalid')
        .send({ name: 'Foreign request' })
        .expect(403);
      expect(denied.headers['access-control-allow-origin']).toBeUndefined();
      await write('/auth/logout').send({}).expect(204);
      await request(app)
        .get('/api/v1/auth/session')
        .set('Origin', origin)
        .set('Cookie', cookie)
        .expect(401);
      const login = await request(app)
        .post('/api/v1/auth/login')
        .set('Origin', origin)
        .send({ email, password })
        .expect(200);
      expect(login.headers['access-control-allow-origin']).toBe(origin);
    },
  );
});
