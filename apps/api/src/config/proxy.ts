import type { Express } from 'express';
import { isIP } from 'node:net';
import proxyaddr from 'proxy-addr';
import { z } from 'zod';

export const proxyCidr = z.string().refine((value) => {
  const [ip, prefix, extra] = value.split('/');
  const family = isIP(ip);
  if (!family || extra !== undefined) return false;
  if (
    prefix !== undefined &&
    (!/^\d+$/.test(prefix) || Number(prefix) < 1 || Number(prefix) > (family === 4 ? 32 : 128))
  )
    return false;
  try {
    proxyaddr.compile([value]);
    return true;
  } catch {
    return false;
  }
}, 'Use an explicit trusted proxy IP/CIDR, never a wildcard or /0 range');

export function configureProxy(app: Express, cidrs: readonly string[] = []) {
  const trusted = cidrs.map((value) => proxyCidr.parse(value));
  app.set('trust proxy', trusted.length ? proxyaddr.compile(trusted) : false);
  app.use((req, _res, next) => {
    // Forwarded hosts never determine application identity; Origin is checked separately.
    delete req.headers['x-forwarded-host'];
    delete req.headers.forwarded;
    if (!['http', 'https'].includes(String(req.headers['x-forwarded-proto'])))
      delete req.headers['x-forwarded-proto'];
    next();
  });
}
