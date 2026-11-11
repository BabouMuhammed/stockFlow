// @vitest-environment node
import { describe, expect, it } from 'vitest';
import { readFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import { validateHosting } from '../hosting';

const config = JSON.parse(
  readFileSync(fileURLToPath(new URL('../vercel.json', import.meta.url)), 'utf8'),
);
describe('Vercel deployment routing', () => {
  it('orders the API proxy before the SPA fallback and fails closed before host configuration', () => {
    expect(() => validateHosting(config, false)).not.toThrow();
    const configured = structuredClone(config);
    configured.rewrites[0].destination = 'https://stockflow-verification.onrender.com/api/:path*';
    expect(() => validateHosting(configured, true)).not.toThrow();
    const unconfigured = structuredClone(configured);
    unconfigured.rewrites[0].destination =
      'https://stockflow-api-not-configured.invalid/api/:path*';
    expect(() => validateHosting(unconfigured, true)).toThrow('actual Render API hostname');
    expect(() => validateHosting({ rewrites: [...configured.rewrites].reverse() }, false)).toThrow(
      'precede',
    );
  });
  it.each([
    'http://api.onrender.com/api/:path*',
    'https://api.onrender.com/other/:path*',
    'https://api.onrender.com.attacker.example/api/:path*',
    'https://user:password@api.onrender.com/api/:path*',
    'https://api.onrender.com/api/:path*?x=1',
  ])('rejects invalid upstream %s', (destination) => {
    const modified = structuredClone(config);
    modified.rewrites[0].destination = destination;
    expect(() => validateHosting(modified, false)).toThrow();
  });
  it('preserves API path prefixes and keeps deep links on the SPA', () => {
    const [api, spa] = config.rewrites;
    // This checks the committed route contract, not an emulation of Vercel's CDN.
    expect(api.source).toBe('/api/:path*');
    expect(new URL(api.destination).pathname).toBe('/api/:path*');
    expect(spa).toEqual({ source: '/(.*)', destination: '/index.html' });
    expect(
      config.rewrites.filter((r: { destination: string }) => r.destination === '/index.html'),
    ).toHaveLength(1);
  });
});
