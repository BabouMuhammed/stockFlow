import type { WebOrigins } from '../config/origins';
import { Prisma, type PrismaClient, type Role } from '@prisma/client';
import { createHash } from 'node:crypto';
import { Router, type RequestHandler } from 'express';
import { ApiError } from '../utils/http';
import { identity, requireSession, verifyCsrf, type Identity } from '../security/session';
import { MAX_MINOR } from '../utils/validation';
import { extendedMinor, quantityThousandths } from '../utils/money';

export function protectedRouter(db: PrismaClient, origin: WebOrigins) {
  const router = Router();
  router.use(requireSession(db));
  router.use((req, res, next) => {
    try {
      if (!['GET', 'HEAD', 'OPTIONS'].includes(req.method)) verifyCsrf(req, res, origin);
      next();
    } catch (error) {
      next(error);
    }
  });
  return router;
}
export function roles(...allowed: Role[]): RequestHandler {
  return (_req, res, next) =>
    allowed.includes(identity(res).user.role)
      ? next()
      : next(new ApiError(403, 'FORBIDDEN', 'Your role cannot perform this operation'));
}
export const operators = roles('OWNER', 'MANAGER');
export const ownerOnly = roles('OWNER');
export const fingerprint = (value: unknown) =>
  createHash('sha256')
    .update(JSON.stringify(value, (_k, v) => (typeof v === 'bigint' ? v.toString() : v)))
    .digest('hex');
export async function serial<T>(
  db: PrismaClient,
  work: (tx: Prisma.TransactionClient) => Promise<T>,
): Promise<T> {
  for (let attempt = 0; ; attempt++) {
    try {
      return await db.$transaction(work, { isolationLevel: 'Serializable', timeout: 15000 });
    } catch (error) {
      if (
        attempt < 4 &&
        error instanceof Prisma.PrismaClientKnownRequestError &&
        ['P2034', 'P2002'].includes(error.code)
      )
        continue;
      throw error;
    }
  }
}
export async function lockKey(tx: Prisma.TransactionClient, businessId: string, key: string) {
  await tx.$executeRaw`SELECT pg_advisory_xact_lock(hashtextextended(${businessId + ':' + key}, 0))`;
}
export function checkReplay(stored: { requestHash: string | null }, hash: string) {
  if (stored.requestHash !== hash)
    throw new ApiError(
      409,
      'IDEMPOTENCY_CONFLICT',
      'This request key was already used with different details',
    );
}
export function boundedMoney(value: bigint) {
  if (value < 0n || value > MAX_MINOR)
    throw new ApiError(
      400,
      'AMOUNT_OUT_OF_RANGE',
      'Calculated amount is outside the supported range',
    );
  return value;
}
// PostgreSQL quantities have three decimals. Round half up once per line, in minor units.
export function lineMoney(unitMinor: bigint, quantity: Prisma.Decimal | string) {
  const thousandths = quantityThousandths(
    typeof quantity === 'string' ? quantity : quantity.toFixed(3),
  );
  return boundedMoney(extendedMinor(unitMinor, thousandths));
}
export async function mainBranch(tx: Prisma.TransactionClient, businessId: string) {
  const branch = await tx.branch.findFirst({ where: { businessId, code: 'MAIN' } });
  if (!branch)
    throw new ApiError(409, 'BRANCH_REQUIRED', 'This business needs a main branch before trading');
  return branch.id;
}
export async function audit(
  tx: Prisma.TransactionClient,
  auth: Identity,
  action: string,
  entityType: string,
  entityId: string,
  metadata?: Prisma.InputJsonValue,
) {
  await tx.auditLog.create({
    data: {
      businessId: auth.user.businessId,
      userId: auth.user.id,
      action,
      entityType,
      entityId,
      ...(metadata === undefined ? {} : { metadata }),
    },
  });
}
export async function moveStock(
  tx: Prisma.TransactionClient,
  auth: Identity,
  branchId: string,
  productId: string,
  delta: Prisma.Decimal,
  movementType: 'RECEIPT' | 'SALE' | 'ADJUSTMENT' | 'DAMAGE' | 'RETURN',
  referenceType: string,
  referenceId: string,
  reason: string,
  extra: { idempotencyKey?: string; requestHash?: string } = {},
) {
  const businessId = auth.user.businessId;
  const product = await tx.product.findFirst({ where: { businessId, id: productId } });
  if (!product) throw new ApiError(404, 'NOT_FOUND', 'Product not found');
  if (delta.isZero()) throw new ApiError(400, 'INVALID_QUANTITY', 'Stock change must be nonzero');
  await tx.stockLevel.upsert({
    where: { businessId_branchId_productId: { businessId, branchId, productId } },
    create: { businessId, branchId, productId, quantity: '0' },
    update: {},
  });
  const changed = await tx.stockLevel.updateMany({
    where: {
      businessId,
      branchId,
      productId,
      ...(delta.isNegative() ? { quantity: { gte: delta.abs() } } : {}),
    },
    data: { quantity: { increment: delta } },
  });
  if (!changed.count)
    throw new ApiError(409, 'INSUFFICIENT_STOCK', 'Insufficient stock for ' + product.name);
  const stock = await tx.stockLevel.findUniqueOrThrow({
    where: { businessId_branchId_productId: { businessId, branchId, productId } },
  });
  return tx.stockMovement.create({
    data: {
      businessId,
      branchId,
      productId,
      movementType,
      quantityDelta: delta,
      quantityAfter: stock.quantity,
      referenceType,
      referenceId,
      reason,
      actorId: auth.user.id,
      ...extra,
    },
  });
}
