import { describe, expect, it } from 'vitest';
import { PrismaClient } from '@prisma/client';
import { randomUUID } from 'node:crypto';
import { execFileSync } from 'node:child_process';
import { readdirSync } from 'node:fs';
import { resolve } from 'node:path';
import { allocateStockReceiptReference } from '../modules/stock-receipt-references';
const url = process.env.TEST_DATABASE_URL,
  suite = url ? describe : describe.skip;
suite('additive purchasing migration preserves historical transactions', () => {
  it('retains original quantities, monetary snapshots and payment uncertainty', async () => {
    const target = new URL(url!);
    if (
      !['localhost', '127.0.0.1', '[::1]'].includes(target.hostname) ||
      !/^\/stockflow_test[a-z0-9_]*$/.test(target.pathname)
    )
      throw new Error('Dedicated test database required');
    if (process.env.DATABASE_URL) {
      const main = new URL(process.env.DATABASE_URL);
      if (main.host === target.host && main.pathname === target.pathname)
        throw new Error('Refusing development database');
    }
    const schema = 'purchasing_verify_' + randomUUID().replaceAll('-', '');
    const root = new PrismaClient({ datasourceUrl: url });
    await root.$executeRawUnsafe('CREATE SCHEMA "' + schema + '"');
    target.searchParams.set('schema', schema);
    const db = new PrismaClient({ datasourceUrl: target.toString() });
    const apply = (name: string) =>
      execFileSync(
        process.execPath,
        [
          resolve('../../node_modules/prisma/build/index.js'),
          'db',
          'execute',
          '--schema',
          resolve('prisma/schema.prisma'),
          '--file',
          resolve('prisma/migrations', name, 'migration.sql'),
        ],
        { env: { ...process.env, DATABASE_URL: target.toString() }, stdio: 'pipe' },
      );
    try {
      const current = '20261111000000_supplier_purchasing';
      for (const name of readdirSync(resolve('prisma/migrations'))
        .filter((n) => /^\d/.test(n) && n < current)
        .sort())
        apply(name);
      const business = await db.business.create({
        data: { name: 'Historical migration fixture', isDemo: true },
      });
      const branch = await db.branch.create({
        data: { businessId: business.id, code: 'MAIN', name: 'Main' },
      });
      const supplier = await db.supplier.create({
        data: { businessId: business.id, name: 'Original supplier' },
      });
      const product = await db.product.create({
        data: {
          businessId: business.id,
          name: 'Original product',
          sku: 'ORIGINAL',
          purchaseCostMinor: 9007199254740993n,
          sellingPriceMinor: 9007199254740994n,
        },
      });
      const receiptId = randomUUID();
      await db.$executeRaw`INSERT INTO "StockReceipt" (id,"businessId","branchId","supplierId","supplierName",reference,"idempotencyKey","updatedAt")
        VALUES (${receiptId}::uuid,${business.id}::uuid,${branch.id}::uuid,${supplier.id}::uuid,'Original supplier','ORIGINAL',${randomUUID()},NOW())`;
      await db.$executeRaw`INSERT INTO "StockReceiptItem" (id,"businessId","receiptId","productId","productName",quantity,"unitCostMinor")
        VALUES (${randomUUID()}::uuid,${business.id}::uuid,${receiptId}::uuid,${product.id}::uuid,'Original product',0.125,9007199254740993)`;
      await db.stockLevel.create({
        data: {
          businessId: business.id,
          branchId: branch.id,
          productId: product.id,
          quantity: '0.125',
        },
      });
      const sale = await db.sale.create({
        data: {
          businessId: business.id,
          branchId: branch.id,
          receiptNumber: 'OLD-SALE',
          idempotencyKey: randomUUID(),
          status: 'COMPLETED',
          subtotalMinor: 101n,
          totalMinor: 101n,
          paymentMethod: 'CASH',
          items: {
            create: {
              productId: product.id,
              productName: product.name,
              productSku: product.sku,
              quantity: '0.125',
              unitPriceMinor: 808n,
              unitCostMinor: 800n,
              lineTotalMinor: 101n,
            },
          },
          payments: { create: { method: 'CASH', amountMinor: 101n } },
        },
      });
      const queries = [
        'SELECT id,"supplierId","supplierName",reference,"createdAt" FROM "StockReceipt" ORDER BY id',
        'SELECT id,quantity::text,"unitCostMinor"::text FROM "StockReceiptItem" ORDER BY id',
        'SELECT id,quantity::text FROM "StockLevel" ORDER BY id',
        'SELECT id,"unitCostMinor"::text,quantity::text FROM "SaleItem" ORDER BY id',
        'SELECT id,"totalMinor"::text FROM "Sale" ORDER BY id',
        'SELECT id,"amountMinor"::text FROM "Payment" ORDER BY id',
        'SELECT id,"purchaseCostMinor"::text FROM "Product" ORDER BY id',
      ];
      const snapshot = () => Promise.all(queries.map((q) => db.$queryRawUnsafe(q)));
      const before = await snapshot();
      apply(current);
      expect(await snapshot()).toEqual(before);
      const receipt = await db.stockReceipt.findUniqueOrThrow({
        where: { id: receiptId },
        select: { settlementKnown: true, receivedAt: true, payments: true },
      });
      expect(receipt.settlementKnown).toBe(false);
      expect(receipt.receivedAt).toBeNull();
      expect(receipt.payments).toHaveLength(0);
      expect((await db.sale.findUniqueOrThrow({ where: { id: sale.id } })).totalMinor).toBe(101n);
      // Old split deliveries legitimately reused references. Keep both rows unchanged.
      for (let i = 0; i < 2; i++) {
        await db.$executeRaw`INSERT INTO "StockReceipt" (id,"businessId","branchId","supplierId",reference,"idempotencyKey","updatedAt")
          VALUES (${randomUUID()}::uuid,${business.id}::uuid,${branch.id}::uuid,${supplier.id}::uuid,'SR-000041',${randomUUID()},NOW())`;
      }
      const beforeReferences = await snapshot();
      apply('20261111010000_stock_receipt_references');
      expect(await snapshot()).toEqual(beforeReferences);
      const legacy = await db.stockReceipt.findMany({ where: { businessId: business.id } });
      expect(
        legacy.every((r) => r.internalReference === null && r.supplierInvoiceReference === null),
      ).toBe(true);
      expect(
        (await db.stockReceiptCounter.findUniqueOrThrow({ where: { businessId: business.id } }))
          .nextValue,
      ).toBe(42n);
      expect(await db.$transaction((tx) => allocateStockReceiptReference(tx, business.id))).toBe(
        'SR-000042',
      );
      // If a future code is imported after migration, allocation skips it as well.
      await db.stockReceiptCounter.update({
        where: { businessId: business.id },
        data: { nextValue: 41n },
      });
      expect(await db.$transaction((tx) => allocateStockReceiptReference(tx, business.id))).toBe(
        'SR-000042',
      );
    } finally {
      await db.$disconnect();
      await root.$disconnect();
    }
  }, 60000);
});
