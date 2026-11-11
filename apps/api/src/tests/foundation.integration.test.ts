import { beforeAll, afterAll, describe, expect, it } from 'vitest';
import { PrismaClient } from '@prisma/client';
import { randomUUID } from 'node:crypto';
import { execFileSync } from 'node:child_process';
import { resolve } from 'node:path';
import { DEMO_BUSINESS_ID } from '../../prisma/demo-policy';
const url = process.env.TEST_DATABASE_URL;
const suite = url ? describe : describe.skip;
let db: PrismaClient;
const businessId = randomUUID(),
  otherBusinessId = randomUUID(),
  branchId = randomUUID(),
  productId = randomUUID();
suite('PostgreSQL migrations, tenant constraints and seed safety (dedicated database)', () => {
  beforeAll(async () => {
    const target = new URL(url!);
    if (
      !/stockflow_test/.test(target.pathname) ||
      !['localhost', '127.0.0.1', '[::1]'].includes(target.hostname)
    )
      throw new Error('Use a dedicated local database named stockflow_test.');
    if (process.env.DATABASE_URL) {
      const main = new URL(process.env.DATABASE_URL);
      if (target.host === main.host && target.pathname === main.pathname)
        throw new Error('Test and development databases must differ.');
    }
    execFileSync(
      process.execPath,
      [
        resolve('../../node_modules/prisma/build/index.js'),
        'migrate',
        'deploy',
        '--schema',
        resolve('prisma/schema.prisma'),
      ],
      { env: { ...process.env, DATABASE_URL: url }, stdio: 'pipe' },
    );
    db = new PrismaClient({ datasourceUrl: url });
    await db.$queryRawUnsafe('SELECT 1');
  }, 60000);
  afterAll(async () => {
    await db?.$disconnect();
  });
  it('runs the seed twice without overwriting edited illustrative prices', async () => {
    const seed = () =>
      execFileSync(
        process.execPath,
        [resolve('../../node_modules/tsx/dist/cli.mjs'), 'prisma/seed.ts'],
        { env: { ...process.env, DATABASE_URL: url, ALLOW_DEMO_SEED: 'true' }, stdio: 'pipe' },
      );
    seed();
    const p = await db.product.findFirstOrThrow({
      where: { sku: 'RICE-25', businessId: DEMO_BUSINESS_ID },
    });
    await db.product.update({ where: { id: p.id }, data: { sellingPriceMinor: 220001 } });
    const movements = await db.stockMovement.count();
    seed();
    expect((await db.product.findUniqueOrThrow({ where: { id: p.id } })).sellingPriceMinor).toBe(
      220001n,
    );
    expect(await db.stockMovement.count()).toBe(movements);
  }, 60000);
  it('refuses seeding alongside non-demo business data', async () => {
    const real = await db.business.create({ data: { name: 'Seed refusal fixture' } });
    try {
      expect(() =>
        execFileSync(
          process.execPath,
          [resolve('../../node_modules/tsx/dist/cli.mjs'), 'prisma/seed.ts'],
          { env: { ...process.env, DATABASE_URL: url, ALLOW_DEMO_SEED: 'true' }, stdio: 'pipe' },
        ),
      ).toThrow();
      expect(await db.business.findUnique({ where: { id: real.id } })).not.toBeNull();
    } finally {
      await db.business.delete({ where: { id: real.id } });
    }
  });
  it('enforces tenant foreign keys, uniqueness and nonnegative balances', async () => {
    await db.business.create({ data: { id: businessId, name: 'Constraint test', isDemo: true } });
    await db.business.create({ data: { id: otherBusinessId, name: 'Other test', isDemo: true } });
    await db.branch.create({ data: { id: branchId, businessId, name: 'Main', code: 'MAIN' } });
    await db.product.create({
      data: {
        id: productId,
        businessId,
        name: 'Water',
        sku: 'WATER',
        purchaseCostMinor: 100,
        sellingPriceMinor: 200,
      },
    });
    await expect(
      db.product.create({
        data: {
          businessId,
          name: 'Duplicate',
          sku: 'WATER',
          purchaseCostMinor: 100,
          sellingPriceMinor: 200,
        },
      }),
    ).rejects.toThrow();
    await expect(
      db.stockLevel.create({
        data: { businessId: otherBusinessId, branchId, productId, quantity: '1.250' },
      }),
    ).rejects.toThrow();
    await expect(
      db.stockLevel.create({ data: { businessId, branchId, productId, quantity: '-1.000' } }),
    ).rejects.toThrow();
    const level = await db.stockLevel.create({
      data: { businessId, branchId, productId, quantity: '1.250' },
    });
    expect(level.quantity.toFixed(3)).toBe('1.250');
  });
  it('rejects stock ledger mutations and restricted product deletion', async () => {
    const movement = await db.stockMovement.create({
      data: {
        businessId,
        branchId,
        productId,
        movementType: 'RECEIPT',
        quantityDelta: '1.250',
        quantityAfter: '1.250',
        referenceType: 'TEST',
      },
    });
    await expect(
      db.stockMovement.update({ where: { id: movement.id }, data: { reason: 'edit' } }),
    ).rejects.toThrow();
    await expect(db.stockMovement.delete({ where: { id: movement.id } })).rejects.toThrow();
    await expect(db.product.delete({ where: { id: productId } })).rejects.toThrow();
  });
});
