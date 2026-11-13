import type { WebOrigins } from '../config/origins';
import { Prisma, type PrismaClient } from '@prisma/client';
import { z } from 'zod';
import { identity } from '../security/session';
import { route } from '../utils/http';
import { operators, protectedRouter } from './operations';
import { dateWhere, saleQuery } from './sales';
import { purchasingSummary, receiptView } from './purchasing';
import { extendedMinor, quantityThousandths } from '../utils/money';

export const reportDates = saleQuery
  .pick({ from: true, to: true })
  .refine((v) => !v.from || !v.to || v.from <= v.to, 'Start date must not follow end date')
  .refine(
    (v) =>
      !v.from || !v.to || (new Date(v.to).getTime() - new Date(v.from).getTime()) / 86400000 < 366,
    'Choose at most 366 days per report',
  );
export function csvCell(value: unknown) {
  let text = value === null || value === undefined ? '' : String(value);
  if (/^[\s]*[=+\-@\t\r]/.test(text)) text = "'" + text;
  return '"' + text.replaceAll('"', '""') + '"';
}
export async function reportSummary(
  db: PrismaClient,
  businessId: string,
  from: string,
  to: string,
) {
  const start = new Date(from + 'T00:00:00Z'),
    end = new Date(new Date(to + 'T00:00:00Z').getTime() + 86400000);
  const period = Prisma.sql`s."createdAt">=${start} AND s."createdAt"<${end}`;
  const values = await db.$transaction(
    async (tx) => {
      const financial = await tx.$queryRaw<
        Array<{ revenueMinor: Prisma.Decimal; transactions: bigint; cogsMinor: Prisma.Decimal }>
      >`
        SELECT COALESCE(SUM(s."totalMinor"),0) AS "revenueMinor",COUNT(*) AS transactions,
        COALESCE(SUM((SELECT SUM(ROUND(i."unitCostMinor" * i.quantity)) FROM "SaleItem" i WHERE i."businessId"=s."businessId" AND i."saleId"=s.id)),0) AS "cogsMinor"
        FROM "Sale" s WHERE s."businessId"=${businessId}::uuid AND s.status='COMPLETED' AND ${period}`;
      const refunds = await tx.saleReturn.aggregate({
        where: { businessId, createdAt: { gte: start, lt: end } },
        _sum: { refundMinor: true },
      });
      const returnedCosts = await tx.$queryRaw<
        Array<{ cost: Prisma.Decimal }>
      >`SELECT COALESCE(SUM((item->>'costMinor')::numeric),0) AS cost
        FROM "SaleReturn" r CROSS JOIN LATERAL jsonb_array_elements(r.items) item
        WHERE r."businessId"=${businessId}::uuid AND r."createdAt">=${start} AND r."createdAt"<${end} AND (item->>'restock')::boolean=true`;
      const expenses = await tx.expense.aggregate({
        where: { businessId, date: { gte: start, lt: end } },
        _sum: { amountMinor: true },
      });
      const inventory = await tx.$queryRaw<
        Array<{ products: bigint; lowStock: bigint; valueMinor: Prisma.Decimal }>
      >`SELECT COUNT(*) FILTER(WHERE p."isActive") AS products,
        COUNT(*) FILTER(WHERE p."isActive" AND COALESCE(st.quantity,0)<=p."lowStockThreshold") AS "lowStock",
        COALESCE(SUM(ROUND(COALESCE(st.quantity,0)*p."purchaseCostMinor")),0) AS "valueMinor"
        FROM "Product" p LEFT JOIN "Branch" b ON b."businessId"=p."businessId" AND b.code='MAIN'
        LEFT JOIN "StockLevel" st ON st."businessId"=p."businessId" AND st."branchId"=b.id AND st."productId"=p.id
        WHERE p."businessId"=${businessId}::uuid`;
      const trends =
        await tx.$queryRaw`SELECT day,SUM(revenue) AS "revenueMinor",SUM(cost) AS "costMinor" FROM (
          SELECT to_char(s."createdAt" AT TIME ZONE 'UTC','YYYY-MM-DD') AS day,
            s."totalMinor" AS revenue,
            (SELECT COALESCE(SUM(ROUND(i."unitCostMinor"*i.quantity)),0) FROM "SaleItem" i WHERE i."businessId"=s."businessId" AND i."saleId"=s.id) AS cost
          FROM "Sale" s WHERE s."businessId"=${businessId}::uuid AND s.status='COMPLETED' AND ${period}
          UNION ALL
          SELECT to_char(r."createdAt" AT TIME ZONE 'UTC','YYYY-MM-DD'),-r."refundMinor",
            -(SELECT COALESCE(SUM((item->>'costMinor')::numeric) FILTER (WHERE (item->>'restock')::boolean),0) FROM jsonb_array_elements(r.items) item)
          FROM "SaleReturn" r WHERE r."businessId"=${businessId}::uuid AND r."createdAt">=${start} AND r."createdAt"<${end}
        ) events GROUP BY day ORDER BY day LIMIT 366`;
      const products = await productPerformance(tx, businessId, start, end, 0, 25);
      const purchasing = await purchasingSummary(tx, businessId, start, end);
      const suspectExpenses = await tx.expense.count({
        where: {
          businessId,
          date: { gte: start, lt: end },
          OR: ['inventory', 'stock', 'supplier', 'purchase', 'cogs', 'cost of goods sold'].map(
            (value) => ({ category: { contains: value, mode: 'insensitive' as const } }),
          ),
        },
      });
      const categories =
        await tx.$queryRaw`SELECT COALESCE(c.name,'Uncategorised') AS name,SUM(i."lineTotalMinor"-i."discountMinor") AS "revenueMinor"
        FROM "SaleItem" i JOIN "Sale" s ON s.id=i."saleId" AND s."businessId"=i."businessId"
        JOIN "Product" p ON p.id=i."productId" AND p."businessId"=i."businessId"
        LEFT JOIN "Category" c ON c.id=p."categoryId" AND c."businessId"=p."businessId"
        WHERE s."businessId"=${businessId}::uuid AND s.status='COMPLETED' AND ${period}
        GROUP BY c.name ORDER BY "revenueMinor" DESC LIMIT 25`;
      const cashiers =
        await tx.$queryRaw`SELECT s."cashierId",s."cashierName",COUNT(*) AS transactions,SUM(s."totalMinor") AS "revenueMinor"
        FROM "Sale" s WHERE s."businessId"=${businessId}::uuid AND s.status='COMPLETED' AND ${period}
        GROUP BY s."cashierId",s."cashierName" ORDER BY "revenueMinor" DESC LIMIT 25`;
      const expenseCategories = await tx.expense.groupBy({
        by: ['category'],
        where: { businessId, date: { gte: start, lt: end } },
        _sum: { amountMinor: true },
        orderBy: { _sum: { amountMinor: 'desc' } },
        take: 25,
      });
      const recentSales = await tx.sale.findMany({
        where: { businessId, status: 'COMPLETED', createdAt: { gte: start, lt: end } },
        select: {
          id: true,
          receiptNumber: true,
          totalMinor: true,
          cashierName: true,
          createdAt: true,
        },
        orderBy: [{ createdAt: 'desc' }, { id: 'desc' }],
        take: 10,
      });
      const revenueMinor = BigInt(financial[0].revenueMinor.toFixed(0)),
        refundMinor = refunds._sum.refundMinor ?? 0n;
      const cogsMinor =
        BigInt(financial[0].cogsMinor.toFixed(0)) - BigInt(returnedCosts[0].cost.toFixed(0));
      const expensesMinor = expenses._sum.amountMinor ?? 0n;
      return {
        from,
        to,
        timezone: 'Africa/Banjul',
        revenueMinor,
        refundMinor,
        netRevenueMinor: revenueMinor - refundMinor,
        cogsMinor,
        grossProfitMinor: revenueMinor - refundMinor - cogsMinor,
        expensesMinor,
        estimatedOperatingResultMinor: revenueMinor - refundMinor - cogsMinor - expensesMinor,
        transactions: financial[0].transactions,
        ...inventory[0],
        ...purchasing,
        suspectExpenseCount: suspectExpenses,
        trends,
        bestProducts: products,
        categories,
        cashiers,
        expenseCategories,
        recentSales,
      };
    },
    { isolationLevel: 'RepeatableRead', timeout: 20000 },
  );
  return values;
}
export function reportsRouter(db: PrismaClient, origin: WebOrigins) {
  const router = protectedRouter(db, origin);
  router.use(operators);
  router.get(
    '/summary',
    route(async (req, res) => {
      const input = reportDates.parse(req.query),
        businessId = identity(res).user.businessId;
      const today = new Date().toISOString().slice(0, 10),
        from = input.from ?? today,
        to = input.to ?? today;
      const values = await reportSummary(db, businessId, from, to);
      res.json(values);
    }),
  );
  router.get(
    '/export',
    route(async (req, res) => {
      const input = reportDates
        .safeExtend({
          kind: z.enum([
            'sales',
            'products',
            'inventory',
            'low-stock',
            'expenses',
            'cashiers',
            'gross-profit',
            'purchases',
            'supplier-payments',
          ]),
        })
        .parse(req.query);
      const businessId = identity(res).user.businessId;
      res.set({
        'Content-Type': 'text/csv; charset=utf-8',
        'Content-Disposition': 'attachment; filename="stockflow-' + input.kind + '.csv"',
      });
      const write = (values: unknown[]) => res.write(values.map(csvCell).join(',') + '\r\n');
      if (input.kind === 'gross-profit') {
        const today = new Date().toISOString().slice(0, 10);
        const data = await reportSummary(db, businessId, input.from ?? today, input.to ?? today);
        write(['Metric', 'Minor units GMD']);
        for (const key of [
          'revenueMinor',
          'refundMinor',
          'netRevenueMinor',
          'cogsMinor',
          'grossProfitMinor',
          'expensesMinor',
          'estimatedOperatingResultMinor',
          'purchasesMinor',
          'supplierPaymentsMinor',
          'outstandingSupplierMinor',
          'unreconciledPurchaseMinor',
        ] as const)
          write([key, data[key]]);
        res.end();
        return;
      }
      if (input.kind === 'sales')
        write([
          'Receipt',
          'Date (Africa/Banjul)',
          'Cashier',
          'Subtotal minor GMD',
          'Discount minor GMD',
          'Total minor GMD',
          'Refunds minor GMD',
          'Payment',
        ]);
      else if (input.kind === 'expenses')
        write(['Title', 'Category', 'Date', 'Operating expense minor GMD', 'Payment']);
      else if (input.kind === 'purchases')
        write([
          'StockFlow receipt / legacy reference',
          'Supplier invoice / delivery note',
          'Supplier',
          'Receipt date',
          'Purchase value minor GMD',
          'Current recorded paid minor GMD',
          'Current verified outstanding minor GMD',
          'Payment status',
        ]);
      else if (input.kind === 'supplier-payments')
        write([
          'Payment ID',
          'Reference',
          'Supplier',
          'Payment date',
          'Net outflow minor GMD',
          'Method',
          'Reverses payment',
          'Notes',
        ]);
      else if (input.kind === 'cashiers')
        write(['Cashier', 'Transactions before returns', 'Sales revenue minor GMD before returns']);
      else if (input.kind === 'products')
        write([
          'Product',
          'SKU',
          'Net quantity sold',
          'Net revenue minor GMD',
          'COGS minor GMD after restocked returns',
        ]);
      else
        write([
          'Product',
          'SKU',
          'Stock',
          'Minimum',
          'Unit cost minor GMD',
          'Inventory value minor GMD',
        ]);
      for (let skip = 0; !req.destroyed; skip += 250) {
        let count = 0;
        if (input.kind === 'purchases') {
          const range = dateWhere(input.from, input.to);
          const rows = await db.stockReceipt.findMany({
            where: {
              businessId,
              OR: [{ receivedAt: range }, { receivedAt: null, createdAt: range }],
            },
            include: { items: true, payments: true },
            orderBy: { id: 'asc' },
            skip,
            take: 250,
          });
          count = rows.length;
          for (const raw of rows) {
            const r = receiptView(raw);
            write([
              r.reference,
              r.supplierInvoiceReference,
              r.supplierName,
              r.receiptDate.toISOString(),
              r.totalMinor,
              r.paidMinor,
              r.outstandingMinor,
              r.paymentStatus,
            ]);
          }
        } else if (input.kind === 'supplier-payments') {
          const rows = await db.supplierPayment.findMany({
            where: { businessId, date: dateWhere(input.from, input.to) },
            include: { receipt: { select: { reference: true, supplierName: true } } },
            orderBy: { id: 'asc' },
            skip,
            take: 250,
          });
          count = rows.length;
          for (const r of rows)
            write([
              r.id,
              r.receipt.reference,
              r.receipt.supplierName,
              r.date.toISOString(),
              r.reversalOfId ? -r.amountMinor : r.amountMinor,
              r.method,
              r.reversalOfId,
              r.notes,
            ]);
        } else if (input.kind === 'sales') {
          const rows = await db.sale.findMany({
            where: { businessId, status: 'COMPLETED', createdAt: dateWhere(input.from, input.to) },
            include: { returns: { select: { refundMinor: true } } },
            orderBy: { id: 'asc' },
            skip,
            take: 250,
          });
          count = rows.length;
          for (const r of rows)
            write([
              r.receiptNumber,
              r.createdAt.toISOString(),
              r.cashierName,
              r.subtotalMinor,
              r.discountMinor,
              r.totalMinor,
              r.returns.reduce((s, v) => s + v.refundMinor, 0n),
              r.paymentMethod,
            ]);
        } else if (input.kind === 'expenses') {
          const rows = await db.expense.findMany({
            where: { businessId, date: dateWhere(input.from, input.to) },
            orderBy: { id: 'asc' },
            skip,
            take: 250,
          });
          count = rows.length;
          for (const r of rows)
            write([
              r.title,
              r.category,
              r.date.toISOString().slice(0, 10),
              r.amountMinor,
              r.paymentMethod,
            ]);
        } else if (input.kind === 'cashiers' || input.kind === 'products') {
          const start = input.from ? new Date(input.from + 'T00:00:00Z') : new Date(0),
            end = input.to
              ? new Date(new Date(input.to + 'T00:00:00Z').getTime() + 86400000)
              : new Date();
          const rows =
            input.kind === 'cashiers'
              ? await db.$queryRaw<
                  Array<Record<string, unknown>>
                >`SELECT s."cashierName" AS name,COUNT(*) AS count,SUM(s."totalMinor") AS revenue FROM "Sale" s WHERE s."businessId"=${businessId}::uuid AND s.status='COMPLETED' AND s."createdAt">=${start} AND s."createdAt"<${end} GROUP BY s."cashierId",s."cashierName" ORDER BY s."cashierId" LIMIT 250 OFFSET ${skip}`
              : await db.$queryRaw<
                  Array<Record<string, unknown>>
                >`${productPerformanceSql(businessId, start, end, skip, 250)}`;
          count = rows.length;
          for (const r of rows)
            write(
              input.kind === 'cashiers'
                ? [r.name, r.count, r.revenue]
                : [r.productName, r.productSku, r.quantity, r.revenueMinor, r.costMinor],
            );
        } else {
          const rows = await db.product.findMany({
            where: { businessId, ...(input.kind === 'low-stock' ? { isActive: true } : {}) },
            include: { stockLevels: { where: { branch: { code: 'MAIN' } } } },
            orderBy: { id: 'asc' },
            skip,
            take: 250,
          });
          count = rows.length;
          for (const r of rows) {
            const quantity = r.stockLevels[0]?.quantity ?? new Prisma.Decimal(0);
            if (input.kind !== 'low-stock' || quantity.lte(r.lowStockThreshold))
              write([
                r.name,
                r.sku,
                quantity,
                r.lowStockThreshold,
                r.purchaseCostMinor,
                extendedMinor(r.purchaseCostMinor, quantityThousandths(quantity.toFixed(3))),
              ]);
          }
        }
        if (count < 250) break;
      }
      res.end();
    }),
  );
  return router;
}

function productPerformanceSql(
  businessId: string,
  start: Date,
  end: Date,
  skip: number,
  limit: number,
) {
  return Prisma.sql`SELECT "productId","productName","productSku",SUM(quantity) AS quantity,
    SUM(revenue) AS "revenueMinor",SUM(cost) AS "costMinor" FROM (
    SELECT i."productId",i."productName",i."productSku",i.quantity,
      i."lineTotalMinor"-i."discountMinor" AS revenue,ROUND(i.quantity*i."unitCostMinor") AS cost
    FROM "SaleItem" i JOIN "Sale" s ON s.id=i."saleId" AND s."businessId"=i."businessId"
    WHERE s."businessId"=${businessId}::uuid AND s.status='COMPLETED' AND s."createdAt">=${start} AND s."createdAt"<${end}
    UNION ALL
    SELECT i."productId",i."productName",i."productSku",-(item->>'quantity')::numeric,
      -(item->>'refundMinor')::numeric,CASE WHEN (item->>'restock')::boolean THEN -(item->>'costMinor')::numeric ELSE 0 END
    FROM "SaleReturn" r CROSS JOIN LATERAL jsonb_array_elements(r.items) item
    JOIN "SaleItem" i ON i.id=(item->>'saleItemId')::uuid AND i."businessId"=r."businessId" AND i."saleId"=r."saleId"
    WHERE r."businessId"=${businessId}::uuid AND r."createdAt">=${start} AND r."createdAt"<${end}
    ) events GROUP BY "productId","productName","productSku" ORDER BY SUM(quantity) DESC,"productId","productName","productSku" LIMIT ${limit} OFFSET ${skip}`;
}
function productPerformance(
  tx: Prisma.TransactionClient,
  businessId: string,
  start: Date,
  end: Date,
  skip: number,
  limit: number,
) {
  return tx.$queryRaw(productPerformanceSql(businessId, start, end, skip, limit));
}
