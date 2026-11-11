import type { WebOrigins } from '../config/origins';
import { Prisma, type PrismaClient } from '@prisma/client';
import { randomUUID } from 'node:crypto';
import { z } from 'zod';
import { identity } from '../security/session';
import { ApiError, route } from '../utils/http';
import { decimalQuantity, minorUnits, text, uuid } from '../utils/validation';
import {
  audit,
  checkReplay,
  fingerprint,
  lockKey,
  mainBranch,
  moveStock,
  operators,
  protectedRouter,
  serial,
} from './operations';

export const stockQuery = z
  .object({
    search: z.string().trim().max(120).default(''),
    low: z.enum(['true', 'false']).optional(),
    page: z.coerce.number().int().min(1).max(100000).default(1),
    limit: z.coerce.number().int().min(1).max(100).default(25),
  })
  .strict();
const positiveQuantity = decimalQuantity.refine(
  (v) => new Prisma.Decimal(v).gt(0),
  'Quantity must be positive',
);
const receiveInput = z
  .object({
    productId: uuid,
    quantity: positiveQuantity,
    unitCostMinor: minorUnits,
    supplierId: uuid.optional(),
    reference: text(120),
    idempotencyKey: uuid,
  })
  .strict();
const adjustmentInput = z
  .object({
    productId: uuid,
    quantity: positiveQuantity,
    direction: z.enum(['ADD', 'REMOVE']),
    type: z.enum(['OPENING', 'ADJUSTMENT', 'DAMAGE']).default('ADJUSTMENT'),
    reason: text(240),
    idempotencyKey: uuid,
  })
  .strict();

export function inventoryRouter(db: PrismaClient, origin: WebOrigins) {
  const router = protectedRouter(db, origin);
  router.use(operators);
  router.get(
    '/',
    route(async (req, res) => {
      const input = stockQuery.parse(req.query),
        businessId = identity(res).user.businessId;
      const branchId = await mainBranch(db, businessId);
      // Filtering low stock is performed in SQL against each product's threshold, including zero-stock products.
      const filter = Prisma.sql`p."businessId"=${businessId}::uuid AND p."isActive"=true
      AND (p."name" ILIKE ${'%' + input.search + '%'} OR p."sku" ILIKE ${'%' + input.search + '%'})
      ${input.low === 'true' ? Prisma.sql`AND COALESCE(s.quantity,0) <= p."lowStockThreshold"` : Prisma.empty}`;
      const rows = await db.$queryRaw<
        Array<{
          id: string;
          name: string;
          sku: string;
          quantity: Prisma.Decimal;
          lowStockThreshold: Prisma.Decimal;
          purchaseCostMinor: bigint;
        }>
      >`
      SELECT p.id,p.name,p.sku,p."lowStockThreshold",p."purchaseCostMinor",COALESCE(s.quantity,0)::decimal(18,3) AS quantity
      FROM "Product" p LEFT JOIN "StockLevel" s ON s."businessId"=p."businessId" AND s."productId"=p.id AND s."branchId"=${branchId}::uuid
      WHERE ${filter} ORDER BY p.name,p.id LIMIT ${input.limit} OFFSET ${(input.page - 1) * input.limit}`;
      const counts = await db.$queryRaw<
        Array<{ total: bigint }>
      >`SELECT COUNT(*) AS total FROM "Product" p
      LEFT JOIN "StockLevel" s ON s."businessId"=p."businessId" AND s."productId"=p.id AND s."branchId"=${branchId}::uuid WHERE ${filter}`;
      res.json({
        data: rows,
        total: Number(counts[0].total),
        page: input.page,
        limit: input.limit,
      });
    }),
  );
  router.get(
    '/movements',
    route(async (req, res) => {
      const input = stockQuery
        .omit({ low: true })
        .extend({ productId: uuid.optional() })
        .parse(req.query);
      const where = {
        businessId: identity(res).user.businessId,
        ...(input.productId ? { productId: input.productId } : {}),
        ...(input.search
          ? {
              product: {
                OR: [
                  { name: { contains: input.search, mode: 'insensitive' as const } },
                  { sku: { contains: input.search, mode: 'insensitive' as const } },
                ],
              },
            }
          : {}),
      };
      const [data, total] = await db.$transaction([
        db.stockMovement.findMany({
          where,
          include: { product: { select: { name: true, sku: true } } },
          orderBy: [{ createdAt: 'desc' }, { id: 'desc' }],
          skip: (input.page - 1) * input.limit,
          take: input.limit,
        }),
        db.stockMovement.count({ where }),
      ]);
      res.json({ data, total, page: input.page, limit: input.limit });
    }),
  );
  router.get(
    '/receipts',
    route(async (req, res) => {
      const input = stockQuery
          .omit({ low: true })
          .extend({ supplierId: uuid.optional() })
          .parse(req.query),
        businessId = identity(res).user.businessId;
      const where = {
        businessId,
        reference: { contains: input.search, mode: 'insensitive' as const },
        ...(input.supplierId ? { supplierId: input.supplierId } : {}),
      };
      const [data, total] = await db.$transaction([
        db.stockReceipt.findMany({
          where,
          include: { items: true },
          orderBy: [{ createdAt: 'desc' }, { id: 'desc' }],
          skip: (input.page - 1) * input.limit,
          take: input.limit,
        }),
        db.stockReceipt.count({ where }),
      ]);
      res.json({ data, total, page: input.page, limit: input.limit });
    }),
  );
  router.post(
    '/receipts',
    route(async (req, res) => {
      const input = receiveInput.parse(req.body),
        auth = identity(res),
        businessId = auth.user.businessId,
        hash = fingerprint(input);
      const receipt = await serial(db, async (tx) => {
        await lockKey(tx, businessId, input.idempotencyKey);
        const previous = await tx.stockReceipt.findUnique({
          where: {
            businessId_idempotencyKey: { businessId, idempotencyKey: input.idempotencyKey },
          },
          include: { items: true },
        });
        if (previous) {
          checkReplay(previous, hash);
          return previous;
        }
        const product = await tx.product.findFirst({
          where: { id: input.productId, businessId, isActive: true },
        });
        if (!product) throw new ApiError(404, 'NOT_FOUND', 'Active product not found');
        const supplier = input.supplierId
          ? await tx.supplier.findFirst({
              where: { id: input.supplierId, businessId, isActive: true },
            })
          : null;
        if (input.supplierId && !supplier)
          throw new ApiError(404, 'NOT_FOUND', 'Supplier not found');
        const branchId = await mainBranch(tx, businessId);
        const created = await tx.stockReceipt.create({
          data: {
            businessId,
            branchId,
            supplierId: supplier?.id,
            supplierName: supplier?.name,
            reference: input.reference,
            idempotencyKey: input.idempotencyKey,
            requestHash: hash,
            actorId: auth.user.id,
            items: {
              create: {
                productId: product.id,
                productName: product.name,
                quantity: input.quantity,
                unitCostMinor: input.unitCostMinor,
              },
            },
          },
          include: { items: true },
        });
        await moveStock(
          tx,
          auth,
          branchId,
          product.id,
          new Prisma.Decimal(input.quantity),
          'RECEIPT',
          'StockReceipt',
          created.id,
          input.reference,
        );
        await tx.product.update({
          where: { id: product.id },
          data: { purchaseCostMinor: input.unitCostMinor },
        });
        await audit(tx, auth, 'STOCK_RECEIVE', 'StockReceipt', created.id);
        return created;
      });
      res.status(201).json(receipt);
    }),
  );
  router.post(
    '/adjustments',
    route(async (req, res) => {
      const input = adjustmentInput.parse(req.body),
        auth = identity(res),
        businessId = auth.user.businessId,
        hash = fingerprint(input);
      const movement = await serial(db, async (tx) => {
        await lockKey(tx, businessId, input.idempotencyKey);
        const previous = await tx.stockMovement.findUnique({
          where: {
            businessId_idempotencyKey: { businessId, idempotencyKey: input.idempotencyKey },
          },
        });
        if (previous) {
          checkReplay(previous, hash);
          return previous;
        }
        const branchId = await mainBranch(tx, businessId);
        if (input.type === 'DAMAGE' && input.direction !== 'REMOVE')
          throw new ApiError(400, 'INVALID_QUANTITY', 'Damaged stock must be removed');
        if (input.type === 'OPENING') {
          if (
            input.direction !== 'ADD' ||
            (await tx.stockMovement.count({
              where: { businessId, branchId, productId: input.productId },
            }))
          )
            throw new ApiError(
              409,
              'OPENING_EXISTS',
              'Opening stock is only permitted before stock movements',
            );
        }
        const delta = new Prisma.Decimal(input.quantity).mul(input.direction === 'ADD' ? 1 : -1);
        const created = await moveStock(
          tx,
          auth,
          branchId,
          input.productId,
          delta,
          input.type === 'DAMAGE' ? 'DAMAGE' : 'ADJUSTMENT',
          input.type,
          randomUUID(),
          input.reason,
          { idempotencyKey: input.idempotencyKey, requestHash: hash },
        );
        await audit(tx, auth, 'STOCK_' + input.type, 'StockMovement', created.id);
        return created;
      });
      res.status(201).json(movement);
    }),
  );
  return router;
}
