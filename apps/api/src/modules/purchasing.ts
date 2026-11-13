import { Prisma } from '@prisma/client';
import { z } from 'zod';
import { decimalQuantity, minorUnits, text, uuid } from '../utils/validation';
import { boundedMoney, lineMoney } from './operations';
import { ApiError } from '../utils/http';
import { extendedMinor, quantityThousandths } from '../utils/money';

export const recordedDate = z.iso
  .date()
  .refine(
    (v) => v <= new Date().toISOString().slice(0, 10),
    'Recorded transactions cannot be dated in the future',
  );

const receiptItem = z
  .object({
    productId: uuid,
    quantity: decimalQuantity.refine(
      (v) => decimalQuantity.safeParse(v).success && new Prisma.Decimal(v).gt(0),
      'Quantity must be positive',
    ),
    unitCostMinor: minorUnits,
  })
  .strict();
const receiptFields = {
  supplierId: uuid.optional(),
  // Backward-compatible supplier-document alias; never used to choose an internal code.
  reference: text(120).optional(),
  supplierInvoiceReference: z.string().trim().max(120).optional(),
  idempotencyKey: uuid,
  receivedDate: recordedDate.optional(),
  notes: z.string().trim().max(2000).default(''),
  repeatReferenceReason: z.string().trim().min(5).max(240).optional(),
};
// Preserve the legacy single-product contract while rejecting mixed/ambiguous payloads.
export const receiveInput = z
  .union([
    z.object({ ...receiptFields, items: z.array(receiptItem).min(1).max(100) }).strict(),
    z.object({ ...receiptFields, ...receiptItem.shape }).strict(),
  ])
  .transform((v) => ({
    ...v,
    items:
      'items' in v
        ? v.items
        : [{ productId: v.productId, quantity: v.quantity, unitCostMinor: v.unitCostMinor }],
  }))
  .refine(
    (v) => new Set(v.items.map((i) => i.productId)).size === v.items.length,
    'Each product may appear only once; combine its quantities',
  )
  .refine(
    (v) =>
      !v.reference || !v.supplierInvoiceReference || v.reference === v.supplierInvoiceReference,
    'Provide one consistent supplier invoice reference',
  );

export const settlementInput = z
  .object({
    amountMinor: minorUnits.refine((v) => v > 0n, 'Payment must be positive'),
    date: recordedDate,
    method: z.enum(['CASH', 'BANK_TRANSFER', 'MOBILE_MONEY', 'CARD']),
    reference: z.string().trim().max(120).optional(),
    notes: z.string().trim().max(2000).default(''),
    confirmed: z.literal(true, { error: 'Confirm that the supplier payment was actually made' }),
    idempotencyKey: uuid,
  })
  .strict()
  .refine(
    (v) => v.method === 'CASH' || !!v.reference,
    'Supply a reference for a manually confirmed external payment',
  );

export function purchaseTotal(
  items: { unitCostMinor: bigint; quantity: string | Prisma.Decimal }[],
  bounded = true,
) {
  const total = items.reduce(
    (sum, i) =>
      sum +
      (bounded
        ? lineMoney(i.unitCostMinor, i.quantity)
        : extendedMinor(
            i.unitCostMinor,
            quantityThousandths(
              typeof i.quantity === 'string' ? i.quantity : i.quantity.toFixed(3),
            ),
          )),
    0n,
  );
  return bounded ? boundedMoney(total) : total;
}
export type ReceiptAmounts = {
  items: { unitCostMinor: bigint; quantity: string | Prisma.Decimal }[];
  payments: { amountMinor: bigint; reversalOfId: string | null }[];
  settlementKnown: boolean;
};
export function receiptAmounts(receipt: ReceiptAmounts) {
  const totalMinor = purchaseTotal(receipt.items, false);
  const paidMinor = receipt.payments.reduce(
    (s, p) => s + (p.reversalOfId ? -p.amountMinor : p.amountMinor),
    0n,
  );
  if (paidMinor < 0n || paidMinor > totalMinor)
    throw new ApiError(409, 'INVALID_SETTLEMENT', 'Receipt payments require reconciliation');
  return {
    totalMinor,
    paidMinor,
    outstandingMinor: receipt.settlementKnown ? totalMinor - paidMinor : null,
    paymentStatus: !receipt.settlementKnown
      ? 'UNRECONCILED'
      : paidMinor === totalMinor
        ? 'PAID'
        : paidMinor === 0n
          ? 'UNPAID'
          : 'PARTIALLY_PAID',
  };
}
export function receiptView<
  T extends ReceiptAmounts & {
    receivedAt: Date | null;
    createdAt: Date;
    reference: string;
    internalReference: string | null;
    supplierInvoiceReference: string | null;
  },
>(receipt: T) {
  return {
    ...receipt,
    ...receiptAmounts(receipt),
    receiptDate: receipt.receivedAt ?? receipt.createdAt,
    items: receipt.items.map((i) => ({
      ...i,
      lineTotalMinor: extendedMinor(
        i.unitCostMinor,
        quantityThousandths(typeof i.quantity === 'string' ? i.quantity : i.quantity.toFixed(3)),
      ),
    })),
  };
}

// Shared SQL avoids multiplying receipt totals by their number of payments.
export async function purchasingSummary(
  tx: Prisma.TransactionClient,
  businessId: string,
  start: Date,
  end: Date,
  supplierId?: string,
) {
  const filter = supplierId ? Prisma.sql`AND r."supplierId"=${supplierId}::uuid` : Prisma.empty;
  const [row] = await tx.$queryRaw<
    Array<{
      purchasesMinor: Prisma.Decimal;
      supplierPaymentsMinor: Prisma.Decimal;
      outstandingSupplierMinor: Prisma.Decimal;
      unreconciledPurchaseMinor: Prisma.Decimal;
      unreconciledPurchases: bigint;
      purchaseCount: bigint;
      totalPurchaseMinor: Prisma.Decimal;
      totalSupplierPaidMinor: Prisma.Decimal;
    }>
  >`WITH receipts AS (
    SELECT r.id, r."settlementKnown", COALESCE(r."receivedAt",r."createdAt") AS date,
      COALESCE((SELECT SUM(ROUND(i.quantity*i."unitCostMinor")) FROM "StockReceiptItem" i
        WHERE i."businessId"=r."businessId" AND i."receiptId"=r.id),0) AS total,
      COALESCE((SELECT SUM(CASE WHEN p."reversalOfId" IS NULL THEN p."amountMinor" ELSE -p."amountMinor" END)
        FROM "SupplierPayment" p WHERE p."businessId"=r."businessId" AND p."receiptId"=r.id),0) AS paid,
      r."supplierId"
    FROM "StockReceipt" r WHERE r."businessId"=${businessId}::uuid ${filter}
  ) SELECT
    COALESCE(SUM(total) FILTER (WHERE date>=${start} AND date<${end}),0) AS "purchasesMinor",
    COALESCE((SELECT SUM(CASE WHEN p."reversalOfId" IS NULL THEN p."amountMinor" ELSE -p."amountMinor" END)
      FROM "SupplierPayment" p WHERE p."businessId"=${businessId}::uuid
      AND p.date>=${start} AND p.date<${end}
      ${supplierId ? Prisma.sql`AND p."supplierId"=${supplierId}::uuid` : Prisma.empty}),0) AS "supplierPaymentsMinor",
    COALESCE(SUM(total-paid) FILTER (WHERE "settlementKnown" AND "supplierId" IS NOT NULL),0) AS "outstandingSupplierMinor",
    COALESCE(SUM(total) FILTER (WHERE NOT "settlementKnown"),0) AS "unreconciledPurchaseMinor",
    COUNT(*) FILTER (WHERE NOT "settlementKnown") AS "unreconciledPurchases",
    COUNT(*) AS "purchaseCount", COALESCE(SUM(total),0) AS "totalPurchaseMinor",
    COALESCE(SUM(paid),0) AS "totalSupplierPaidMinor" FROM receipts`;
  return {
    purchasesMinor: BigInt(row.purchasesMinor.toFixed(0)),
    supplierPaymentsMinor: BigInt(row.supplierPaymentsMinor.toFixed(0)),
    outstandingSupplierMinor: BigInt(row.outstandingSupplierMinor.toFixed(0)),
    unreconciledPurchaseMinor: BigInt(row.unreconciledPurchaseMinor.toFixed(0)),
    unreconciledPurchases: row.unreconciledPurchases,
    purchaseCount: row.purchaseCount,
    totalPurchaseMinor: BigInt(row.totalPurchaseMinor.toFixed(0)),
    totalSupplierPaidMinor: BigInt(row.totalSupplierPaidMinor.toFixed(0)),
    balanceBasis: 'CURRENT' as const,
  };
}
