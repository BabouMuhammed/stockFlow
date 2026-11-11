import type { WebOrigins } from '../config/origins';
import { Prisma, type PrismaClient, type Sale, type SaleItem } from '@prisma/client';
import { randomUUID } from 'node:crypto';
import { z } from 'zod';
import { identity } from '../security/session';
import { ApiError, route } from '../utils/http';
import { decimalQuantity, minorUnits, text, uuid } from '../utils/validation';
import { extendedMinor, parseGmdAmount, proratedMinor, quantityThousandths } from '../utils/money';
import {
  audit,
  boundedMoney,
  checkReplay,
  fingerprint,
  lineMoney,
  lockKey,
  mainBranch,
  moveStock,
  operators,
  protectedRouter,
  serial,
} from './operations';

export const paymentMethod = z.enum(['CASH', 'BANK_TRANSFER', 'MOBILE_MONEY', 'CARD']);
const positiveQuantity = decimalQuantity.refine(
  (v) => new Prisma.Decimal(v).gt(0),
  'Quantity must be positive',
);
const gmdAmount = z
  .string()
  .superRefine((value, ctx) => {
    try {
      parseGmdAmount(value);
    } catch (error) {
      ctx.addIssue({
        code: 'custom',
        message: error instanceof Error ? error.message : 'Enter a valid GMD amount',
      });
    }
  })
  .transform(parseGmdAmount);
export const checkoutInput = z
  .object({
    idempotencyKey: uuid,
    items: z
      .array(z.object({ productId: uuid, quantity: positiveQuantity }).strict())
      .min(1)
      .max(100),
    paymentMethod,
    amountReceivedMinor: minorUnits.optional(),
    amountReceived: gmdAmount.optional(),
    exactPayment: z.literal(true).optional(),
    discount: z
      .discriminatedUnion('type', [
        z.object({ type: z.literal('FIXED'), amountMinor: minorUnits }).strict(),
        z
          .object({ type: z.literal('PERCENT'), basisPoints: z.number().int().min(0).max(10000) })
          .strict(),
      ])
      .optional(),
    manualConfirmation: z.boolean().default(false),
    paymentReference: z.string().trim().max(120).optional(),
    customerId: uuid.optional(),
  })
  .strict()
  .refine(
    (v) => new Set(v.items.map((i) => i.productId)).size === v.items.length,
    'Combine duplicate cart lines',
  )
  .refine(
    (v) =>
      Number(v.amountReceived !== undefined) +
        Number(v.amountReceivedMinor !== undefined) +
        Number(v.exactPayment === true) ===
      1,
    {
      message: 'Provide one payment amount, or exactPayment for cash, but not both',
      path: ['amountReceived'],
    },
  )
  .refine((v) => !v.exactPayment || v.paymentMethod === 'CASH', {
    message: 'Exact payment without an amount is available only for cash',
    path: ['exactPayment'],
  })
  .transform((v) => ({
    // Keep the original normalized property order for existing checkout retry hashes.
    idempotencyKey: v.idempotencyKey,
    items: v.items,
    paymentMethod: v.paymentMethod,
    amountReceivedMinor: v.amountReceived ?? v.amountReceivedMinor,
    discount: v.discount,
    manualConfirmation: v.manualConfirmation,
    paymentReference: v.paymentReference,
    customerId: v.customerId,
    ...(v.exactPayment ? { exactPayment: true as const } : {}),
  }));
export function discountedTotal(
  subtotal: bigint,
  discount?: z.infer<typeof checkoutInput>['discount'],
) {
  const amount = discount
    ? discount.type === 'FIXED'
      ? discount.amountMinor
      : (subtotal * BigInt(discount.basisPoints) + 5000n) / 10000n
    : 0n;
  if (amount > subtotal)
    throw new ApiError(400, 'INVALID_DISCOUNT', 'Discount exceeds the subtotal');
  return { discountMinor: amount, totalMinor: boundedMoney(subtotal - amount) };
}
export const saleQuery = z
  .object({
    search: z.string().trim().max(120).default(''),
    page: z.coerce.number().int().min(1).max(100000).default(1),
    limit: z.coerce.number().int().min(1).max(100).default(25),
    from: z.iso.date().optional(),
    to: z.iso.date().optional(),
    cashierId: uuid.optional(),
    paymentMethod: paymentMethod.optional(),
  })
  .strict();
export function dateWhere(from?: string, to?: string) {
  return {
    ...(from ? { gte: new Date(from + 'T00:00:00.000Z') } : {}),
    ...(to ? { lt: new Date(new Date(to + 'T00:00:00.000Z').getTime() + 86400000) } : {}),
  };
}
function saleDto<T extends Sale & { items: SaleItem[]; returns?: { items: Prisma.JsonValue }[] }>(
  sale: T,
  cashier: boolean,
) {
  return {
    ...sale,
    items: sale.items.map(({ unitCostMinor, ...item }) =>
      cashier ? item : { ...item, unitCostMinor },
    ),
    ...(cashier && sale.returns
      ? {
          returns: sale.returns.map((record) => ({
            ...record,
            items: Array.isArray(record.items)
              ? record.items.map((item) => {
                  if (item && typeof item === 'object' && !Array.isArray(item)) {
                    const safe = { ...item };
                    delete safe.costMinor;
                    return safe;
                  }
                  return item;
                })
              : record.items,
          })),
        }
      : {}),
  };
}
export function salesRouter(db: PrismaClient, origin: WebOrigins) {
  const router = protectedRouter(db, origin);
  router.post(
    '/',
    route(async (req, res) => {
      const input = checkoutInput.parse(req.body),
        auth = identity(res),
        businessId = auth.user.businessId;
      if (auth.user.role === 'CASHIER' && input.discount)
        throw new ApiError(403, 'FORBIDDEN', 'Discounts require an owner or manager');
      if (input.paymentMethod !== 'CASH' && (!input.manualConfirmation || !input.paymentReference))
        throw new ApiError(
          400,
          'MANUAL_CONFIRMATION_REQUIRED',
          'Confirm receipt of the external payment and supply a reference. StockFlow does not process electronic payments.',
        );
      const hash = fingerprint({ ...input, cashierId: auth.user.id });
      const sale = await serial(db, async (tx) => {
        await lockKey(tx, businessId, input.idempotencyKey);
        const previous = await tx.sale.findUnique({
          where: {
            businessId_idempotencyKey: { businessId, idempotencyKey: input.idempotencyKey },
          },
          include: { items: true, payments: true, returns: true },
        });
        if (previous) {
          checkReplay(previous, hash);
          return previous;
        }
        if (
          input.customerId &&
          !(await tx.customer.findFirst({ where: { id: input.customerId, businessId } }))
        )
          throw new ApiError(404, 'NOT_FOUND', 'Customer not found');
        const branchId = await mainBranch(tx, businessId);
        const products = await tx.product.findMany({
          where: { businessId, id: { in: input.items.map((i) => i.productId) }, isActive: true },
        });
        if (products.length !== input.items.length)
          throw new ApiError(404, 'NOT_FOUND', 'A product is unavailable');
        const lines = input.items
          .slice()
          .sort((a, b) => a.productId.localeCompare(b.productId))
          .map((i) => {
            const p = products.find((p) => p.id === i.productId)!;
            return {
              productId: p.id,
              productName: p.name,
              productSku: p.sku,
              quantity: new Prisma.Decimal(i.quantity),
              unitPriceMinor: p.sellingPriceMinor,
              unitCostMinor: p.purchaseCostMinor,
              lineTotalMinor: lineMoney(p.sellingPriceMinor, i.quantity),
              discountMinor: 0n,
            };
          });
        const subtotalMinor = boundedMoney(lines.reduce((s, l) => s + l.lineTotalMinor, 0n));
        if (subtotalMinor === 0n)
          throw new ApiError(400, 'INVALID_TOTAL', 'The sale subtotal must be positive');
        const totals = discountedTotal(subtotalMinor, input.discount);
        // Resolve exact cash only after pricing and discounts inside the transaction.
        const amountReceivedMinor = input.exactPayment
          ? totals.totalMinor
          : input.amountReceivedMinor!;
        if (amountReceivedMinor < totals.totalMinor)
          throw new ApiError(
            400,
            'INSUFFICIENT_PAYMENT',
            'Amount received is below the sale total. Partial payments are not supported.',
          );
        if (input.paymentMethod !== 'CASH' && amountReceivedMinor !== totals.totalMinor)
          throw new ApiError(400, 'INVALID_PAYMENT', 'External payment must equal the total');
        // Cumulative allocation ensures every discount minor unit is assigned exactly once.
        let running = 0n,
          allocated = 0n;
        for (const line of lines) {
          running += line.lineTotalMinor;
          const next = (totals.discountMinor * running) / subtotalMinor;
          line.discountMinor = next - allocated;
          allocated = next;
        }
        const receiptSnapshot = {
          businessName: auth.business.name,
          phone: auth.business.phone,
          address: auth.business.address,
          email: auth.business.email,
          header: auth.business.receiptHeader,
          footer: auth.business.receiptFooter,
          currency: 'GMD',
          cashierName: auth.user.name,
        };
        const created = await tx.sale.create({
          data: {
            businessId,
            branchId,
            receiptNumber: 'SF-' + randomUUID().toUpperCase(),
            idempotencyKey: input.idempotencyKey,
            requestHash: hash,
            cashierId: auth.user.id,
            cashierName: auth.user.name,
            customerId: input.customerId,
            receiptSnapshot,
            status: 'COMPLETED',
            subtotalMinor,
            ...totals,
            paymentMethod: input.paymentMethod,
            amountReceivedMinor,
            changeMinor: amountReceivedMinor - totals.totalMinor,
            items: { create: lines },
            payments: {
              create: {
                method: input.paymentMethod,
                amountMinor: totals.totalMinor,
                reference: input.paymentReference,
                verification: input.paymentMethod === 'CASH' ? 'CASH_RECEIVED' : 'MANUAL_RECORD',
              },
            },
          },
          include: { items: true, payments: true, returns: true },
        });
        for (const line of lines)
          await moveStock(
            tx,
            auth,
            branchId,
            line.productId,
            line.quantity.negated(),
            'SALE',
            'Sale',
            created.id,
            created.receiptNumber,
          );
        await audit(tx, auth, 'SALE_COMPLETE', 'Sale', created.id);
        return created;
      });
      res.status(201).json(saleDto(sale, auth.user.role === 'CASHIER'));
    }),
  );
  router.get(
    '/',
    route(async (req, res) => {
      const input = saleQuery
          .refine((v) => !v.from || !v.to || v.from <= v.to, 'Start date must not follow end date')
          .parse(req.query),
        auth = identity(res);
      const where: Prisma.SaleWhereInput = {
        businessId: auth.user.businessId,
        ...(auth.user.role === 'CASHIER'
          ? { cashierId: auth.user.id }
          : input.cashierId
            ? { cashierId: input.cashierId }
            : {}),
        ...(input.search ? { receiptNumber: { contains: input.search, mode: 'insensitive' } } : {}),
        ...(input.paymentMethod ? { paymentMethod: input.paymentMethod } : {}),
        createdAt: dateWhere(input.from, input.to),
      };
      const [data, total] = await db.$transaction([
        db.sale.findMany({
          where,
          include: { items: true, payments: true, returns: true },
          orderBy: [{ createdAt: 'desc' }, { id: 'desc' }],
          skip: (input.page - 1) * input.limit,
          take: input.limit,
        }),
        db.sale.count({ where }),
      ]);
      res.json({
        data: data.map((s) => saleDto(s, auth.user.role === 'CASHIER')),
        total,
        page: input.page,
        limit: input.limit,
      });
    }),
  );
  router.get(
    '/:id',
    route(async (req, res) => {
      const auth = identity(res),
        sale = await db.sale.findFirst({
          where: {
            id: uuid.parse(req.params.id),
            businessId: auth.user.businessId,
            ...(auth.user.role === 'CASHIER' ? { cashierId: auth.user.id } : {}),
          },
          include: { items: true, payments: true, returns: true },
        });
      if (!sale) throw new ApiError(404, 'NOT_FOUND', 'Sale not found');
      res.json(saleDto(sale, auth.user.role === 'CASHIER'));
    }),
  );
  router.post(
    '/:id/returns',
    operators,
    route(async (req, res) => {
      const saleId = uuid.parse(req.params.id),
        auth = identity(res),
        businessId = auth.user.businessId;
      const input = z
        .object({
          idempotencyKey: uuid,
          reason: text(240),
          refundMethod: paymentMethod,
          manualConfirmation: z.literal(true),
          items: z
            .array(
              z
                .object({ saleItemId: uuid, quantity: positiveQuantity, restock: z.boolean() })
                .strict(),
            )
            .min(1)
            .max(100),
        })
        .strict()
        .refine(
          (v) => new Set(v.items.map((i) => i.saleItemId)).size === v.items.length,
          'Combine duplicate return lines',
        )
        .parse(req.body);
      const hash = fingerprint({ saleId, ...input });
      const record = await serial(db, async (tx) => {
        await lockKey(tx, businessId, input.idempotencyKey);
        const previous = await tx.saleReturn.findUnique({
          where: {
            businessId_idempotencyKey: { businessId, idempotencyKey: input.idempotencyKey },
          },
        });
        if (previous) {
          checkReplay(previous, hash);
          return previous;
        }
        const sale = await tx.sale.findFirst({
          where: { id: saleId, businessId, status: 'COMPLETED' },
          include: { items: true, returns: true },
        });
        if (!sale) throw new ApiError(404, 'NOT_FOUND', 'Completed sale not found');
        const prior = sale.returns.flatMap(
          (r) => r.items as unknown as Array<{ saleItemId: string; quantity: string }>,
        );
        const lines = input.items.map((i) => {
          const sold = sale.items.find((s) => s.id === i.saleItemId);
          if (!sold) throw new ApiError(404, 'NOT_FOUND', 'Sale item not found');
          const returned = prior
            .filter((p) => p.saleItemId === i.saleItemId)
            .reduce((q, p) => q.add(p.quantity), new Prisma.Decimal(0));
          const next = returned.add(i.quantity);
          if (next.gt(sold.quantity))
            throw new ApiError(
              409,
              'EXCESS_RETURN',
              'Return quantity exceeds the remaining sold quantity',
            );
          const net = sold.lineTotalMinor - sold.discountMinor;
          const cumulative = (q: Prisma.Decimal) =>
            proratedMinor(
              net,
              quantityThousandths(q.toFixed(3)),
              quantityThousandths(sold.quantity.toFixed(3)),
            );
          return {
            ...i,
            productId: sold.productId,
            refundMinor: (cumulative(next) - cumulative(returned)).toString(),
            costMinor: (
              extendedMinor(sold.unitCostMinor, quantityThousandths(next.toFixed(3))) -
              extendedMinor(sold.unitCostMinor, quantityThousandths(returned.toFixed(3)))
            ).toString(),
          };
        });
        const refundMinor = lines.reduce((s, l) => s + BigInt(l.refundMinor), 0n);
        const created = await tx.saleReturn.create({
          data: {
            businessId,
            saleId,
            idempotencyKey: input.idempotencyKey,
            requestHash: hash,
            reason: input.reason,
            actorId: auth.user.id,
            refundMinor,
            refundMethod: input.refundMethod,
            items: lines,
          },
        });
        for (const line of lines)
          if (line.restock)
            await moveStock(
              tx,
              auth,
              sale.branchId,
              line.productId,
              new Prisma.Decimal(line.quantity),
              'RETURN',
              'SaleReturn',
              created.id,
              input.reason,
            );
        await audit(tx, auth, 'SALE_RETURN', 'SaleReturn', created.id);
        return created;
      });
      res.status(201).json(record);
    }),
  );
  return router;
}
