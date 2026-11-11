import { describe, expect, it } from 'vitest';
import { PrismaClient } from '@prisma/client';
import { randomUUID } from 'node:crypto';
import { execFileSync } from 'node:child_process';
import { resolve } from 'node:path';
const url = process.env.TEST_DATABASE_URL;
const suite = url ? describe : describe.skip;
suite('Phase 1 to Phase 2A monetary migration preservation', () => {
  it('widens every monetary column without changing historical values or fractional quantities', async () => {
    const target = new URL(url!);
    if (
      !/^\/stockflow_test[a-z0-9_]*$/.test(target.pathname) ||
      !['localhost', '127.0.0.1', '[::1]'].includes(target.hostname)
    )
      throw new Error('Dedicated local stockflow_test database required');
    if (process.env.DATABASE_URL) {
      const main = new URL(process.env.DATABASE_URL);
      if (main.host === target.host && main.pathname === target.pathname)
        throw new Error('Test and development databases must differ');
    }
    // A new schema preserves every existing test/business record; no database reset or DROP.
    const schema = 'money_verify_' + randomUUID().replaceAll('-', '');
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
          resolve('prisma/migrations/' + name + '/migration.sql'),
        ],
        { env: { ...process.env, DATABASE_URL: target.toString() }, stdio: 'pipe' },
      );
    try {
      apply('20261108000000_init');
      apply('20261108010000_phase1_foundation');
      // Use the historical SQL contract: the current generated client includes later columns.
      const businessId = randomUUID(),
        branchId = randomUUID(),
        productId = randomUUID(),
        receiptId = randomUUID(),
        saleId = randomUUID();
      await db.$executeRaw`INSERT INTO "Business" (id,name,"isDemo","updatedAt") VALUES (${businessId}::uuid,'Monetary migration fixture',true,NOW())`;
      await db.$executeRaw`INSERT INTO "Branch" (id,"businessId",name,code,"updatedAt") VALUES (${branchId}::uuid,${businessId}::uuid,'Fixture','MAIN',NOW())`;
      await db.$executeRaw`INSERT INTO "Product" (id,"businessId",name,sku,"purchaseCostMinor","sellingPriceMinor","updatedAt") VALUES (${productId}::uuid,${businessId}::uuid,'Fixture product','FIXTURE',2147483646,2147483647,NOW())`;
      await db.$executeRaw`INSERT INTO "StockLevel" (id,"businessId","branchId","productId",quantity,"updatedAt") VALUES (${randomUUID()}::uuid,${businessId}::uuid,${branchId}::uuid,${productId}::uuid,1.125,NOW())`;
      await db.$executeRaw`INSERT INTO "StockReceipt" (id,"businessId","branchId",reference,"idempotencyKey","updatedAt") VALUES (${receiptId}::uuid,${businessId}::uuid,${branchId}::uuid,'FIXTURE',${randomUUID()},NOW())`;
      await db.$executeRaw`INSERT INTO "StockReceiptItem" (id,"businessId","receiptId","productId","productName",quantity,"unitCostMinor") VALUES (${randomUUID()}::uuid,${businessId}::uuid,${receiptId}::uuid,${productId}::uuid,'Fixture product',2.125,2147483645)`;
      await db.$executeRaw`INSERT INTO "Sale" (id,"businessId","branchId","receiptNumber","idempotencyKey",status,"subtotalMinor","totalMinor","paymentMethod","updatedAt") VALUES (${saleId}::uuid,${businessId}::uuid,${branchId}::uuid,'FIXTURE',${randomUUID()},'COMPLETED',2147483644,2147483643,'CASH',NOW())`;
      await db.$executeRaw`INSERT INTO "SaleItem" (id,"businessId","saleId","productId","productName","productSku",quantity,"unitPriceMinor","unitCostMinor","lineTotalMinor") VALUES (${randomUUID()}::uuid,${businessId}::uuid,${saleId}::uuid,${productId}::uuid,'Fixture product','FIXTURE',1.125,2147483642,2147483641,2147483640)`;
      await db.$executeRaw`INSERT INTO "Payment" (id,"businessId","saleId",method,"amountMinor") VALUES (${randomUUID()}::uuid,${businessId}::uuid,${saleId}::uuid,'CASH',2147483643)`;
      const queries = [
        `SELECT "purchaseCostMinor"::text AS cost, "sellingPriceMinor"::text AS price FROM "Product"`,
        `SELECT "unitCostMinor"::text AS cost, "quantity"::text AS quantity FROM "StockReceiptItem"`,
        `SELECT "subtotalMinor"::text AS subtotal,"totalMinor"::text AS total FROM "Sale"`,
        `SELECT "unitPriceMinor"::text AS price,"unitCostMinor"::text AS cost,"lineTotalMinor"::text AS total,"quantity"::text AS quantity FROM "SaleItem"`,
        `SELECT "amountMinor"::text AS amount FROM "Payment"`,
        `SELECT "quantity"::text AS quantity FROM "StockLevel"`,
      ];
      const snapshot = async () => Promise.all(queries.map((query) => db.$queryRawUnsafe(query)));
      const before = await snapshot();
      const beforeTypes = await db.$queryRaw<
        Array<{ data_type: string }>
      >`SELECT data_type FROM information_schema.columns WHERE table_schema=${schema} AND column_name LIKE '%Minor'`;
      expect(beforeTypes).toHaveLength(9);
      expect(beforeTypes.every((row) => row.data_type === 'integer')).toBe(true);
      apply('20261108020000_phase2a_bigint');
      expect(await snapshot()).toEqual(before);
      const afterTypes = await db.$queryRaw<
        Array<{ data_type: string }>
      >`SELECT data_type FROM information_schema.columns WHERE table_schema=${schema} AND column_name LIKE '%Minor'`;
      expect(afterTypes).toHaveLength(9);
      expect(afterTypes.every((row) => row.data_type === 'bigint')).toBe(true);
      await db.$executeRaw`UPDATE "Product" SET "sellingPriceMinor"=9223372036854775807 WHERE id=${productId}::uuid`;
      const exact = await db.$queryRaw<
        Array<{ value: string }>
      >`SELECT "sellingPriceMinor"::text AS value FROM "Product" WHERE id=${productId}::uuid`;
      expect(exact[0].value).toBe('9223372036854775807');
      const beforeOperations = await snapshot();
      apply('20261110000000_retail_operations');
      apply('20261110010000_actor_constraints');
      expect(await snapshot()).toEqual(beforeOperations);
      await db.$executeRaw`UPDATE "Product" SET sku='PRD-000042' WHERE id=${productId}::uuid`;
      const beforeSku =
        await db.$queryRaw`SELECT id,sku,"purchaseCostMinor"::text,"sellingPriceMinor"::text FROM "Product" ORDER BY id`;
      apply('20261110020000_product_sku_counter');
      expect(
        await db.$queryRaw`SELECT id,sku,"purchaseCostMinor"::text,"sellingPriceMinor"::text FROM "Product" ORDER BY id`,
      ).toEqual(beforeSku);
      const counters = await db.$queryRaw<
        Array<{ nextValue: bigint }>
      >`SELECT "nextValue" FROM "ProductSkuCounter" WHERE "businessId"=${businessId}::uuid`;
      expect(counters[0].nextValue).toBe(43n);
      expect(await snapshot()).toEqual(beforeOperations);
    } finally {
      await db.$disconnect();
      await root.$disconnect();
    }
  }, 60000);
});
