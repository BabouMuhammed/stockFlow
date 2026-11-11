import { Router } from 'express';
import type { PrismaClient } from '@prisma/client';
import { randomBytes } from 'node:crypto';
import { rateLimit } from 'express-rate-limit';
import { z } from 'zod';
import { allowedWebOrigins, allowsOrigin } from '../config/origins';
import { ApiError, route } from '../utils/http';
import { hashPassword, verifyPassword } from '../security/password';
import {
  COOKIE_NAME,
  identity,
  publicSession,
  readToken,
  requireSession,
  tokenHash,
  verifyCsrf,
} from '../security/session';

let dummyHash: Promise<string> | undefined;
const fallbackHash = () => (dummyHash ??= hashPassword(randomBytes(32).toString('hex')));
export type AuthOptions = {
  webOrigin: string;
  webOrigins?: readonly string[];
  sessionHours?: number;
  loginLimit?: number;
  cookieSecure?: boolean;
};
export function authRouter(db: PrismaClient, options: AuthOptions) {
  const router = Router();
  const origins = allowedWebOrigins(options.webOrigin, options.webOrigins);
  const sessionHours = options.sessionHours ?? 8;
  const secure = options.cookieSecure || options.webOrigin.startsWith('https:');
  const cookie = { httpOnly: true, sameSite: 'strict' as const, secure: !!secure, path: '/api/v1' };
  // A random process-local dummy hash makes nonexistent identities take the same KDF path.
  let activeHashes = 0;
  const limit = rateLimit({
    windowMs: 15 * 60 * 1000,
    limit: options.loginLimit ?? 10,
    standardHeaders: 'draft-8',
    legacyHeaders: false,
    skipSuccessfulRequests: true,
    message: { error: 'Too many login attempts; try again later', code: 'RATE_LIMITED' },
  });
  router.post(
    '/register',
    limit,
    route(async (req, res) => {
      if (!allowsOrigin(origins, req.get('Origin')) || !req.is('application/json'))
        throw new ApiError(403, 'CSRF_REJECTED', 'Request origin or content type is not permitted');
      const input = z
        .object({
          businessName: z.string().trim().min(1).max(120),
          name: z.string().trim().min(1).max(120),
          email: z.string().trim().toLowerCase().email().max(254),
          phone: z.string().trim().min(3).max(40),
          address: z.string().trim().max(240).optional(),
          password: z.string().min(12).max(128),
          passwordConfirmation: z.string().min(12).max(128),
        })
        .strict()
        .refine((v) => v.password === v.passwordConfirmation, {
          message: 'Passwords must match',
          path: ['passwordConfirmation'],
        })
        .parse(req.body);
      if (activeHashes >= 2)
        throw new ApiError(429, 'RATE_LIMITED', 'Registration is busy; retry shortly');
      activeHashes++;
      let passwordHash;
      try {
        passwordHash = await hashPassword(input.password);
      } finally {
        activeHashes--;
      }
      const token = randomBytes(32).toString('hex');
      const expiresAt = new Date(Date.now() + sessionHours * 3600000);
      const created = await db.$transaction(async (tx) => {
        await tx.$executeRaw`SELECT pg_advisory_xact_lock(hashtextextended(${input.email}, 0))`;
        if (await tx.user.findFirst({ where: { email: input.email } }))
          throw new ApiError(
            409,
            'EMAIL_EXISTS',
            'This email already has an account; sign in instead',
          );
        const business = await tx.business.create({
          data: {
            name: input.businessName,
            phone: input.phone,
            address: input.address,
            email: input.email,
            branches: { create: { name: 'Main store', code: 'MAIN' } },
          },
        });
        const user = await tx.user.create({
          data: {
            businessId: business.id,
            name: input.name,
            email: input.email,
            passwordHash,
            role: 'OWNER',
          },
        });
        const oldToken = readToken(req);
        if (oldToken)
          await tx.userSession.updateMany({
            where: { tokenHash: tokenHash(oldToken) },
            data: { revokedAt: new Date() },
          });
        const session = await tx.userSession.create({
          data: {
            businessId: business.id,
            userId: user.id,
            tokenHash: tokenHash(token),
            expiresAt,
          },
        });
        await tx.auditLog.create({
          data: {
            businessId: business.id,
            userId: user.id,
            action: 'BUSINESS_REGISTER',
            entityType: 'Business',
            entityId: business.id,
          },
        });
        return { business, user, session, token };
      });
      res.cookie(COOKIE_NAME, token, {
        ...cookie,
        secure: cookie.secure || req.secure,
        maxAge: sessionHours * 3600000,
      });
      res.status(201).json(publicSession(created));
    }),
  );
  router.post(
    '/login',
    limit,
    route(async (req, res) => {
      if (!allowsOrigin(origins, req.get('Origin')) || !req.is('application/json')) {
        throw new ApiError(403, 'CSRF_REJECTED', 'Request origin or content type is not permitted');
      }
      const input = z
        .object({
          businessId: z.string().uuid().optional(),
          email: z.string().trim().toLowerCase().email().max(254),
          password: z.string().min(1).max(128),
        })
        .strict()
        .parse(req.body);
      if (activeHashes >= 2)
        throw new ApiError(429, 'RATE_LIMITED', 'Login is busy; try again shortly');
      activeHashes++;
      let user;
      let valid = false;
      try {
        const users = await db.user.findMany({
          where: {
            ...(input.businessId ? { businessId: input.businessId } : {}),
            email: input.email,
          },
          include: { business: true },
          take: 2,
        });
        user = users.length === 1 ? users[0] : undefined;
        valid = await verifyPassword(input.password, user?.passwordHash ?? (await fallbackHash()));
      } finally {
        activeHashes--;
      }
      if (!valid || !user || !user.isActive)
        throw new ApiError(401, 'INVALID_CREDENTIALS', 'Invalid business, email or password');
      const token = randomBytes(32).toString('hex');
      const expiresAt = new Date(Date.now() + sessionHours * 3600000);
      const oldToken = readToken(req);
      const session = await db.$transaction(async (tx) => {
        // Rotate any existing browser session; never reuse an offered token.
        if (oldToken)
          await tx.userSession.updateMany({
            where: { tokenHash: tokenHash(oldToken) },
            data: { revokedAt: new Date() },
          });
        const created = await tx.userSession.create({
          data: {
            businessId: user.businessId,
            userId: user.id,
            tokenHash: tokenHash(token),
            expiresAt,
          },
        });
        await tx.auditLog.create({
          data: {
            businessId: user.businessId,
            userId: user.id,
            action: 'AUTH_LOGIN',
            entityType: 'UserSession',
            entityId: created.id,
          },
        });
        return created;
      });
      res.cookie(COOKIE_NAME, token, {
        ...cookie,
        secure: cookie.secure || req.secure,
        maxAge: sessionHours * 3600000,
      });
      res
        .set('Cache-Control', 'no-store')
        .json(publicSession({ session, user, business: user.business, token }));
    }),
  );
  router.get(
    '/session',
    requireSession(db),
    route(async (_req, res) => {
      res.set('Cache-Control', 'no-store').json(publicSession(identity(res)));
    }),
  );
  router.post(
    '/logout',
    requireSession(db),
    route(async (req, res) => {
      verifyCsrf(req, res, origins);
      const auth = identity(res);
      await db.$transaction(async (tx) => {
        await tx.userSession.update({
          where: { id: auth.session.id },
          data: { revokedAt: new Date() },
        });
        await tx.auditLog.create({
          data: {
            businessId: auth.user.businessId,
            userId: auth.user.id,
            action: 'AUTH_LOGOUT',
            entityType: 'UserSession',
            entityId: auth.session.id,
          },
        });
      });
      res.clearCookie(COOKIE_NAME, { ...cookie, secure: cookie.secure || req.secure });
      res.status(204).end();
    }),
  );
  return router;
}
