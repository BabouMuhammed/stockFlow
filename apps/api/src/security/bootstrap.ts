import { randomUUID } from 'node:crypto';
import type { PrismaClient } from '@prisma/client';
import { z } from 'zod';
import { hashPassword } from './password';
import { ApiError } from '../utils/http';
export function assertLocalBootstrap(
  env: NodeJS.ProcessEnv,
  interactive: boolean,
  confirmed: boolean,
) {
  if (
    !interactive ||
    !confirmed ||
    env.ALLOW_OWNER_BOOTSTRAP !== 'true' ||
    env.NODE_ENV === 'production'
  ) {
    throw new ApiError(
      400,
      'UNSAFE_BOOTSTRAP',
      'Owner bootstrap requires an interactive terminal, local confirmation and ALLOW_OWNER_BOOTSTRAP=true',
    );
  }
  for (const value of [env.DATABASE_URL, env.WEB_ORIGIN ?? 'http://localhost:5173']) {
    const url = new URL(value ?? '');
    if (!['localhost', '127.0.0.1', '[::1]'].includes(url.hostname))
      throw new ApiError(
        400,
        'UNSAFE_BOOTSTRAP',
        'Owner bootstrap requires loopback database and web hosts',
      );
  }
}
export async function bootstrapOwner(
  db: PrismaClient,
  input: {
    businessId?: string;
    businessName: string;
    name: string;
    email: string;
    password: string;
  },
) {
  const data = z
    .object({
      businessId: z.string().uuid().optional(),
      businessName: z.string().trim().min(1).max(120),
      name: z.string().trim().min(1).max(120),
      email: z.string().trim().toLowerCase().email().max(254),
      password: z.string().min(12).max(128),
    })
    .parse(input);
  const passwordHash = await hashPassword(data.password);
  const businessId = data.businessId ?? randomUUID();
  return db.$transaction(
    async (tx) => {
      await tx.$queryRaw`SELECT pg_advisory_xact_lock(hashtext(${businessId}))::text`;
      if (data.businessId) {
        if (!(await tx.business.findUnique({ where: { id: businessId } })))
          throw new ApiError(404, 'NOT_FOUND', 'Selected business does not exist');
      } else {
        await tx.business.create({ data: { id: businessId, name: data.businessName } });
        await tx.branch.create({ data: { businessId, name: 'Main branch', code: 'MAIN' } });
      }
      if (await tx.user.count({ where: { businessId } }))
        throw new ApiError(
          409,
          'BOOTSTRAP_REFUSED',
          'Business already has accounts; bootstrap never overwrites accounts',
        );
      const user = await tx.user.create({
        data: { businessId, name: data.name, email: data.email, passwordHash, role: 'OWNER' },
      });
      await tx.auditLog.create({
        data: {
          businessId,
          userId: user.id,
          action: 'OWNER_BOOTSTRAP',
          entityType: 'User',
          entityId: user.id,
        },
      });
      return { businessId, userId: user.id };
    },
    { isolationLevel: 'Serializable', timeout: 15000 },
  );
}
