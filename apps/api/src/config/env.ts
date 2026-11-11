import { z } from 'zod';
import { config } from 'dotenv';
import { isAbsolute, resolve } from 'node:path';
import { localOrigin, productionOrigin } from './origins';
import { proxyCidr } from './proxy';
config({ path: resolve(process.cwd(), process.cwd().endsWith('api') ? '../../.env' : '.env') });
export const envSchema = z
  .object({
    NODE_ENV: z.enum(['development', 'test', 'production']).default('development'),
    DATABASE_URL: z
      .string()
      .url()
      .refine((url) => /^postgres(?:ql)?:/.test(url), 'PostgreSQL URL required'),
    PORT: z.coerce.number().int().min(1).max(65535).default(5000),
    WEB_ORIGIN: z.union([localOrigin, productionOrigin]).optional(),
    WEB_ORIGINS: z
      .string()
      .max(2048)
      .transform((value) => value.split(',').map((origin) => origin.trim()))
      .pipe(
        z
          .array(z.union([localOrigin, productionOrigin]))
          .min(1)
          .max(8),
      )
      .optional(),
    SESSION_HOURS: z.coerce.number().int().min(1).max(24).default(8),
    TRUSTED_PROXY_CIDRS: z
      .string()
      .max(4096)
      .transform((value) => (value === '' ? [] : value.split(',').map((v) => v.trim())))
      .pipe(z.array(proxyCidr).max(32))
      .default([]),
    IMAGE_STORAGE: z.enum(['local', 'persistent', 'disabled']).optional(),
    UPLOAD_DIR: z
      .string()
      .min(1)
      .refine(isAbsolute, 'Use an absolute persistent upload directory')
      .optional(),
  })
  .superRefine((value, ctx) => {
    const issue = (path: string, message: string) =>
      ctx.addIssue({ code: 'custom', path: [path], message });
    if (value.NODE_ENV === 'production') {
      if (!productionOrigin.safeParse(value.WEB_ORIGIN).success)
        issue('WEB_ORIGIN', 'Production requires an explicit public HTTPS frontend origin');
      for (const entry of value.WEB_ORIGINS ?? [])
        if (!productionOrigin.safeParse(entry).success)
          issue('WEB_ORIGINS', 'Production permits only exact public HTTPS origins');
      if (!value.TRUSTED_PROXY_CIDRS.length)
        issue(
          'TRUSTED_PROXY_CIDRS',
          'Production requires explicitly verified ingress proxy IPs/CIDRs',
        );
      if (value.IMAGE_STORAGE === 'local')
        issue('IMAGE_STORAGE', 'Temporary local image storage is forbidden in production');
    } else {
      for (const entry of [value.WEB_ORIGIN, ...(value.WEB_ORIGINS ?? [])])
        if (entry && !localOrigin.safeParse(entry).success)
          issue('WEB_ORIGIN', 'Development/test frontend origins must be loopback origins');
    }
    if (
      value.WEB_ORIGINS &&
      !value.WEB_ORIGINS.includes(value.WEB_ORIGIN ?? 'http://localhost:5173')
    )
      issue('WEB_ORIGINS', 'The allowlist must include WEB_ORIGIN');
    if (value.IMAGE_STORAGE === 'persistent' && !value.UPLOAD_DIR)
      issue('UPLOAD_DIR', 'Persistent image storage requires UPLOAD_DIR');
    if (value.UPLOAD_DIR && value.IMAGE_STORAGE !== 'persistent')
      issue('UPLOAD_DIR', 'UPLOAD_DIR is used only with persistent storage');
  })
  .transform((value) => ({
    ...value,
    WEB_ORIGIN: value.WEB_ORIGIN ?? 'http://localhost:5173',
    IMAGE_STORAGE:
      value.IMAGE_STORAGE ??
      (value.NODE_ENV === 'production' ? ('disabled' as const) : ('local' as const)),
  }));

export function readEnv(source: NodeJS.ProcessEnv = process.env) {
  const result = envSchema.safeParse(source);
  if (!result.success)
    throw new Error(
      'Invalid environment configuration: ' +
        [...new Set(result.error.issues.map((issue) => issue.path.join('.')))].join(', '),
    );
  return result.data;
}
export const listenHost = (mode: string) => (mode === 'production' ? '0.0.0.0' : '127.0.0.1');
