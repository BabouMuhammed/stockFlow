import { z } from 'zod';
import { isIP } from 'node:net';

export type WebOrigins = string | readonly string[];
export const localOrigin = z
  .string()
  .url()
  .refine((value) => {
    if (!URL.canParse(value)) return false;
    const url = new URL(value);
    return (
      ['http:', 'https:'].includes(url.protocol) &&
      ['localhost', '127.0.0.1', '[::1]'].includes(url.hostname) &&
      value === url.origin
    );
  }, 'Use an exact loopback HTTP(S) origin without a path');

export const productionOrigin = z
  .string()
  .url()
  .refine((value) => {
    if (!URL.canParse(value)) return false;
    const url = new URL(value);
    return (
      url.protocol === 'https:' &&
      value === url.origin &&
      !url.username &&
      !url.password &&
      !url.hostname.includes('*') &&
      !isIP(url.hostname.replace(/^\[|\]$/g, '')) &&
      url.hostname.includes('.') &&
      !url.hostname.endsWith('.localhost') &&
      !url.hostname.endsWith('.local') &&
      url.hostname.split('.').every((label) => /^[a-z0-9](?:[a-z0-9-]*[a-z0-9])?$/.test(label))
    );
  }, 'Use an exact public HTTPS origin without credentials, wildcard or path');

const localFrontends = ['http://localhost:5173', 'http://127.0.0.1:5173'];
export function allowedWebOrigins(primary: string, configured?: readonly string[]) {
  return [
    ...new Set(configured ?? (localFrontends.includes(primary) ? localFrontends : [primary])),
  ];
}
export function allowsOrigin(origins: WebOrigins, supplied: string | undefined) {
  return (
    supplied !== undefined && (typeof origins === 'string' ? [origins] : origins).includes(supplied)
  );
}
