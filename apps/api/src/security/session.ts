import { createHash, timingSafeEqual } from 'node:crypto';
import type { Request, Response, RequestHandler } from 'express';
import type { PrismaClient, User, Business, UserSession } from '@prisma/client';
import { ApiError } from '../utils/http';
import { allowsOrigin, type WebOrigins } from '../config/origins';
export const COOKIE_NAME = 'stockflow_session';
export const tokenHash = (token: string) => createHash('sha256').update(token).digest('hex');
export const csrfToken = (token: string) =>
  createHash('sha256')
    .update('stockflow-csrf:' + token)
    .digest('hex');
export function readToken(req: Request): string | undefined {
  const cookies = (req.headers.cookie ?? '')
    .split(';')
    .map((part) => part.trim())
    .filter((part) => part.startsWith(COOKIE_NAME + '='));
  const token = cookies.length === 1 ? cookies[0].slice(COOKIE_NAME.length + 1) : '';
  return /^[a-f0-9]{64}$/.test(token) ? token : undefined;
}
export type Identity = { session: UserSession; user: User; business: Business; token: string };
export function identity(res: Response): Identity {
  return res.locals.identity as Identity;
}
export function requireSession(db: PrismaClient): RequestHandler {
  return (req, res, next) => {
    void (async () => {
      const token = readToken(req);
      if (!token) throw new ApiError(401, 'UNAUTHENTICATED', 'Sign in to continue');
      const session = await db.userSession.findUnique({
        where: { tokenHash: tokenHash(token) },
        include: { user: true, business: true },
      });
      if (
        !session ||
        session.revokedAt ||
        session.expiresAt <= new Date() ||
        !session.user.isActive
      ) {
        throw new ApiError(401, 'UNAUTHENTICATED', 'Sign in to continue');
      }
      res.locals.identity = { session, user: session.user, business: session.business, token };
    })().then(() => next(), next);
  };
}
export function publicSession(auth: Identity) {
  return {
    user: { id: auth.user.id, name: auth.user.name, email: auth.user.email, role: auth.user.role },
    business: {
      id: auth.business.id,
      name: auth.business.name,
      isDemo: auth.business.isDemo,
      currency: auth.business.currency,
      defaultLowStockThreshold: auth.business.defaultLowStockThreshold,
    },
    expiresAt: auth.session.expiresAt,
    csrfToken: csrfToken(auth.token),
    branchAccess: 'MAIN_STORE' as const,
  };
}
export function verifyCsrf(req: Request, res: Response, origin: WebOrigins) {
  if (!allowsOrigin(origin, req.get('Origin')))
    throw new ApiError(403, 'CSRF_REJECTED', 'Request origin is not permitted');
  const supplied = req.get('X-CSRF-Token') ?? '';
  const expected = csrfToken(identity(res).token);
  if (
    !/^[a-f0-9]{64}$/.test(supplied) ||
    !timingSafeEqual(Buffer.from(supplied), Buffer.from(expected))
  ) {
    throw new ApiError(
      403,
      'CSRF_REJECTED',
      'Security token missing or invalid; refresh and retry',
    );
  }
}
