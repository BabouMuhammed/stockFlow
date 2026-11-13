import type { WebOrigins } from '../config/origins';
import { Prisma, type PrismaClient } from '@prisma/client';
import { randomUUID } from 'node:crypto';
import { z } from 'zod';
import { identity } from '../security/session';
import { ApiError, route } from '../utils/http';
import { decimalQuantity, text, uuid } from '../utils/validation';
import { allocateStockReceiptReference } from './stock-receipt-references';
import {
  purchaseTotal,
  receiptAmounts,
  receiptView,
  receiveInput,
  recordedDate,
  settlementInput,
} from './purchasing';
import {
  audit,
  checkReplay,
  fingerprint,
  lockKey,
  mainBranch,
  moveStock,
  operators,
  ownerOnly,
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
          .extend({
            supplierId: uuid.optional(),
            from: z.iso.date().optional(),
            to: z.iso.date().optional(),
          })
          .parse(req.query),
        businessId = identity(res).user.businessId;
      const where = {
        businessId,
        AND: [
          {
            OR: [
              { reference: { contains: input.search, mode: 'insensitive' as const } },
              {
                supplierInvoiceReference: { contains: input.search, mode: 'insensitive' as const },
              },
            ],
          },
        ],
        ...(input.supplierId ? { supplierId: input.supplierId } : {}),
        ...receiptDates(input.from, input.to),
      };
      const [data, total] = await db.$transaction([
        db.stockReceipt.findMany({
          where,
          include: { items: true, payments: true },
          orderBy: [{ createdAt: 'desc' }, { id: 'desc' }],
          skip: (input.page - 1) * input.limit,
          take: input.limit,
        }),
        db.stockReceipt.count({ where }),
      ]);
      res.json({ data: data.map(receiptView), total, page: input.page, limit: input.limit });
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
          include: { items: true, payments: true },
        });
        if (previous) {
          checkReplay(previous, hash);
          return previous;
        }
        const products = await tx.product.findMany({
          where: { id: { in: input.items.map((i) => i.productId) }, businessId, isActive: true },
        });
        if (products.length !== input.items.length)
          throw new ApiError(404, 'NOT_FOUND', 'An active product was not found');
        purchaseTotal(input.items);
        const supplier = input.supplierId
          ? await tx.supplier.findFirst({
              where: { id: input.supplierId, businessId, isActive: true },
            })
          : null;
        if (input.supplierId && !supplier)
          throw new ApiError(404, 'NOT_FOUND', 'Supplier not found');
        const supplierInvoiceReference = input.supplierInvoiceReference || input.reference || null;
        if (supplier && supplierInvoiceReference) {
          await lockKey(
            tx,
            businessId,
            'invoice:' + supplier.id + ':' + supplierInvoiceReference.toLowerCase(),
          );
          if (
            !input.repeatReferenceReason &&
            (await tx.stockReceipt.findFirst({
              where: {
                businessId,
                supplierId: supplier.id,
                OR: [
                  {
                    supplierInvoiceReference: {
                      equals: supplierInvoiceReference,
                      mode: 'insensitive',
                    },
                  },
                  {
                    internalReference: null,
                    reference: { equals: supplierInvoiceReference, mode: 'insensitive' },
                  },
                ],
              },
            }))
          )
            throw new ApiError(
              409,
              'DUPLICATE_REFERENCE',
              'This supplier reference already exists. For a repeat delivery, provide a reason.',
            );
        }
        const branchId = await mainBranch(tx, businessId);
        const internalReference = await allocateStockReceiptReference(tx, businessId);
        const created = await tx.stockReceipt.create({
          data: {
            businessId,
            branchId,
            supplierId: supplier?.id,
            supplierName: supplier?.name,
            reference: internalReference,
            internalReference,
            supplierInvoiceReference,
            idempotencyKey: input.idempotencyKey,
            requestHash: hash,
            actorId: auth.user.id,
            receivedAt: input.receivedDate
              ? new Date(input.receivedDate + 'T00:00:00Z')
              : new Date(),
            notes: input.notes,
            settlementKnown: !!supplier,
            items: {
              create: input.items.map((i) => ({
                productId: i.productId,
                productName: products.find((p) => p.id === i.productId)!.name,
                quantity: i.quantity,
                unitCostMinor: i.unitCostMinor,
              })),
            },
          },
          include: { items: true, payments: true },
        });
        for (const item of input.items
          .slice()
          .sort((a, b) => a.productId.localeCompare(b.productId))) {
          await moveStock(
            tx,
            auth,
            branchId,
            item.productId,
            new Prisma.Decimal(item.quantity),
            'RECEIPT',
            'StockReceipt',
            created.id,
            internalReference,
          );
          await tx.product.update({
            where: { id: item.productId },
            data: { purchaseCostMinor: item.unitCostMinor },
          });
        }
        await audit(tx, auth, 'STOCK_RECEIVE', 'StockReceipt', created.id, {
          repeatReferenceReason: input.repeatReferenceReason ?? null,
          internalReference,
          supplierInvoiceReference,
        });
        return created;
      });
      res.status(201).json(receiptView(receipt));
    }),
  );
  router.get(
    '/receipts/:id',
    route(async (req, res) => {
      const receipt = await db.stockReceipt.findFirst({
        where: {
          id: uuid.parse(req.params.id),
          businessId: identity(res).user.businessId,
        },
        include: { items: true, payments: { orderBy: [{ date: 'asc' }, { createdAt: 'asc' }] } },
      });
      if (!receipt) throw new ApiError(404, 'NOT_FOUND', 'Receipt not found');
      res.json(receiptView(receipt));
    }),
  );
  router.post(
    '/receipts/:id/payments',
    route(async (req, res) => {
      const input = settlementInput.parse(req.body),
        auth = identity(res),
        businessId = auth.user.businessId;
      const receiptId = uuid.parse(req.params.id),
        hash = fingerprint({ ...input, receiptId });
      const payment = await serial(db, async (tx) => {
        await lockKey(tx, businessId, 'supplier-payment:' + input.idempotencyKey);
        const previous = await tx.supplierPayment.findUnique({
          where: {
            businessId_idempotencyKey: { businessId, idempotencyKey: input.idempotencyKey },
          },
        });
        if (previous) {
          checkReplay(previous, hash);
          return previous;
        }
        await lockKey(tx, businessId, 'receipt-settlement:' + receiptId);
        const receipt = await tx.stockReceipt.findFirst({
          where: { businessId, id: receiptId },
          include: { items: true, payments: true },
        });
        if (!receipt) throw new ApiError(404, 'NOT_FOUND', 'Receipt not found');
        if (!receipt.supplierId)
          throw new ApiError(
            409,
            'SUPPLIER_REQUIRED',
            'This legacy receipt has no supplier; its provenance must be reconciled first',
          );
        const amounts = receiptAmounts(receipt);
        if (input.amountMinor > amounts.totalMinor - amounts.paidMinor)
          throw new ApiError(400, 'OVERPAYMENT', 'Payment exceeds the remaining purchase value');
        const created = await tx.supplierPayment.create({
          data: {
            businessId,
            receiptId,
            supplierId: receipt.supplierId,
            actorId: auth.user.id,
            amountMinor: input.amountMinor,
            date: new Date(input.date + 'T00:00:00Z'),
            method: input.method,
            reference: input.reference,
            notes: input.notes,
            idempotencyKey: input.idempotencyKey,
            requestHash: hash,
          },
        });
        await audit(tx, auth, 'SUPPLIER_PAYMENT', 'SupplierPayment', created.id, { receiptId });
        return created;
      });
      res.status(201).json(payment);
    }),
  );
  router.post(
    '/payments/:id/reverse',
    route(async (req, res) => {
      const input = z
        .object({
          date: recordedDate,
          reason: text(240),
          idempotencyKey: uuid,
          confirmed: z.literal(true),
        })
        .strict()
        .parse(req.body);
      const id = uuid.parse(req.params.id),
        auth = identity(res),
        businessId = auth.user.businessId;
      const hash = fingerprint({ ...input, reversalOfId: id });
      const reversal = await serial(db, async (tx) => {
        await lockKey(tx, businessId, 'supplier-payment:' + input.idempotencyKey);
        const previous = await tx.supplierPayment.findUnique({
          where: {
            businessId_idempotencyKey: { businessId, idempotencyKey: input.idempotencyKey },
          },
        });
        if (previous) {
          checkReplay(previous, hash);
          return previous;
        }
        const original = await tx.supplierPayment.findFirst({ where: { businessId, id } });
        if (!original) throw new ApiError(404, 'NOT_FOUND', 'Payment not found');
        await lockKey(tx, businessId, 'receipt-settlement:' + original.receiptId);
        if (
          original.reversalOfId ||
          (await tx.supplierPayment.findFirst({ where: { businessId, reversalOfId: id } }))
        )
          throw new ApiError(409, 'ALREADY_REVERSED', 'This entry cannot be reversed again');
        const date = new Date(input.date + 'T00:00:00Z');
        if (date < original.date)
          throw new ApiError(400, 'INVALID_DATE', 'A reversal cannot predate its payment');
        const created = await tx.supplierPayment.create({
          data: {
            businessId,
            receiptId: original.receiptId,
            supplierId: original.supplierId,
            actorId: auth.user.id,
            amountMinor: original.amountMinor,
            method: original.method,
            date,
            notes: input.reason,
            reversalOfId: id,
            idempotencyKey: input.idempotencyKey,
            requestHash: hash,
          },
        });
        await audit(tx, auth, 'SUPPLIER_PAYMENT_REVERSE', 'SupplierPayment', created.id, {
          reversalOfId: id,
          reason: input.reason,
        });
        return created;
      });
      res.status(201).json(reversal);
    }),
  );
  router.post(
    '/receipts/:id/reconcile',
    ownerOnly,
    route(async (req, res) => {
      const input = z
        .object({
          confirmAllPaymentsRecorded: z.literal(true),
          reason: text(240),
          idempotencyKey: uuid,
        })
        .strict()
        .parse(req.body);
      const auth = identity(res),
        businessId = auth.user.businessId,
        id = uuid.parse(req.params.id);
      const hash = fingerprint({ ...input, id });
      const result = await serial(db, async (tx) => {
        await lockKey(tx, businessId, 'receipt-settlement:' + id);
        const receipt = await tx.stockReceipt.findFirst({
          where: { businessId, id },
          include: { items: true, payments: true },
        });
        if (!receipt) throw new ApiError(404, 'NOT_FOUND', 'Receipt not found');
        if (receipt.reconciliationKey === input.idempotencyKey) {
          checkReplay({ requestHash: receipt.reconciliationHash }, hash);
          return receipt;
        }
        if (receipt.settlementKnown || !receipt.supplierId)
          throw new ApiError(
            409,
            'RECONCILIATION_UNAVAILABLE',
            'Only unreconciled supplier receipts can be confirmed',
          );
        receiptAmounts(receipt);
        const updated = await tx.stockReceipt.update({
          where: { id },
          data: {
            settlementKnown: true,
            reconciliationKey: input.idempotencyKey,
            reconciliationHash: hash,
          },
          include: { items: true, payments: true },
        });
        await audit(tx, auth, 'SUPPLIER_RECEIPT_RECONCILE', 'StockReceipt', id, {
          reason: input.reason,
        });
        return updated;
      });
      res.json(receiptView(result));
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

function receiptDates(from?: string, to?: string): Prisma.StockReceiptWhereInput {
  if (from && to && from > to)
    throw new ApiError(400, 'INVALID_DATE', 'Start date must not follow end date');
  const range = {
    ...(from ? { gte: new Date(from + 'T00:00:00Z') } : {}),
    ...(to ? { lt: new Date(new Date(to + 'T00:00:00Z').getTime() + 86400000) } : {}),
  };
  return from || to ? { OR: [{ receivedAt: range }, { receivedAt: null, createdAt: range }] } : {};
}
