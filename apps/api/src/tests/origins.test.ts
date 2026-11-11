import { describe, expect, it } from 'vitest';
import request from 'supertest';
import { createApp } from '../app';
import { envSchema } from '../config/env';
import { allowedWebOrigins } from '../config/origins';
const origins = ['http://localhost:5173', 'http://127.0.0.1:5173'];
const app = createApp({ webOrigin: origins[0], checkDatabase: async () => {} });
describe('local origin policy', () => {
  it.each(origins)('reflects only an allowed origin with credentials: %s', async (origin) => {
    const response = await request(app).get('/api/v1/health').set('Origin', origin).expect(200);
    expect(response.headers['access-control-allow-origin']).toBe(origin);
    expect(response.headers['access-control-allow-credentials']).toBe('true');
    expect(response.headers.vary).toContain('Origin');
    const preflight = await request(app)
      .options('/api/v1/auth/register')
      .set('Origin', origin)
      .set('Access-Control-Request-Method', 'POST')
      .set('Access-Control-Request-Headers', 'content-type,x-csrf-token')
      .expect(204);
    expect(preflight.headers['access-control-allow-origin']).toBe(origin);
    expect(preflight.headers['access-control-allow-headers']).toContain('x-csrf-token');
  });
  it.each([
    'http://localhost:5174',
    'http://127.0.0.1:5174',
    'http://localhost:5173.evil.invalid',
    'https://untrusted.invalid',
    'null',
  ])('does not allow %s', async (origin) => {
    const response = await request(app).get('/api/v1/health').set('Origin', origin);
    expect(response.headers['access-control-allow-origin']).toBeUndefined();
  });
  it('validates an explicit allowlist and keeps other origins explicit', () => {
    const env = envSchema.parse({
      DATABASE_URL: 'postgresql://localhost/demo',
      WEB_ORIGINS: origins.join(', '),
    });
    expect(env.WEB_ORIGINS).toEqual(origins);
    for (const value of [
      '*',
      'null',
      'https://untrusted.invalid',
      'http://localhost:5173/',
      'http://user:password@localhost:5173',
      'http://localhost:5173,',
    ])
      expect(
        envSchema.safeParse({ DATABASE_URL: 'postgresql://localhost/demo', WEB_ORIGINS: value })
          .success,
      ).toBe(false);
    expect(allowedWebOrigins('https://localhost:5173')).toEqual(['https://localhost:5173']);
    expect(allowedWebOrigins(origins[0], [origins[1]])).toEqual([origins[1]]);
  });
});
