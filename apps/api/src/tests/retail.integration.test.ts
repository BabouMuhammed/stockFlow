import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import request from 'supertest';
import { PrismaClient } from '@prisma/client';
import { execFileSync } from 'node:child_process';
import { randomBytes, randomUUID } from 'node:crypto';
import { resolve } from 'node:path';
import { createApp } from '../app';

const url = process.env.TEST_DATABASE_URL,
  suite = url ? describe : describe.skip,
  origin = 'http://localhost:5173';
const password = randomBytes(24).toString('hex'),
  email = randomUUID() + '@example.test';
type Auth = { cookie: string; csrf: string; userId: string; businessId: string };
let db: PrismaClient,
  app: ReturnType<typeof createApp>,
  owner: Auth,
  other: Auth,
  cashier: Auth,
  productId: string,
  saleId: string,
  saleItemId: string;
const authFrom = (res: request.Response): Auth => ({
  cookie: String(res.headers['set-cookie'][0]).split(';')[0],
  csrf: res.body.csrfToken,
  userId: res.body.user.id,
  businessId: res.body.business.id,
});
const write = (auth: Auth, path: string, body: unknown, method: 'post' | 'patch' = 'post') =>
  (method === 'post' ? request(app).post('/api/v1' + path) : request(app).patch('/api/v1' + path))
    .set('Origin', origin)
    .set('Cookie', auth.cookie)
    .set('X-CSRF-Token', auth.csrf)
    .send(body);
const read = (auth: Auth, path: string) =>
  request(app)
    .get('/api/v1' + path)
    .set('Cookie', auth.cookie);
const checkout = (quantity = '3', key = randomUUID()) => ({
  idempotencyKey: key,
  items: [{ productId, quantity }],
  paymentMethod: 'CASH',
  amountReceivedMinor: '50000',
});
suite('Retail operations on real PostgreSQL', () => {
  beforeAll(async () => {
    const target = new URL(url!);
    if (
      !['localhost', '127.0.0.1', '[::1]'].includes(target.hostname) ||
      !/^\/stockflow_test[a-z0-9_]*$/.test(target.pathname)
    )
      throw new Error('Dedicated loopback test database required');
    if (process.env.DATABASE_URL) {
      const main = new URL(process.env.DATABASE_URL);
      if (main.host === target.host && main.pathname === target.pathname)
        throw new Error('Test and development databases must differ');
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
    app = createApp({ db, webOrigin: origin, checkDatabase: () => db.$queryRaw`SELECT 1` });
    const register = async (address: string) => {
      const response = await request(app)
        .post('/api/v1/auth/register')
        .set('Origin', origin)
        .send({
          businessName: 'Demo Retail Store',
          name: 'Shop owner',
          email: address,
          phone: '+220 7000000',
          address: 'Serrekunda',
          password,
          passwordConfirmation: password,
        })
        .expect(201);
      const auth = authFrom(response);
      await db.business.update({ where: { id: auth.businessId }, data: { isDemo: true } });
      return auth;
    };
    owner = await register(email);
    other = await register(randomUUID() + '@example.test');
  }, 60000);
  afterAll(async () => {
    await db?.$disconnect();
  });
  it('registers atomically, persists sessions, and supports email-only login', async () => {
    expect((await read(owner, '/auth/session').expect(200)).body.user.role).toBe('OWNER');
    expect(await db.branch.count({ where: { businessId: owner.businessId, code: 'MAIN' } })).toBe(
      1,
    );
    await request(app)
      .post('/api/v1/auth/register')
      .set('Origin', origin)
      .send({
        businessName: 'Duplicate',
        name: 'Other',
        email,
        phone: '12345',
        password,
        passwordConfirmation: password,
      })
      .expect(409);
    const response = await request(app)
      .post('/api/v1/auth/login')
      .set('Origin', origin)
      .send({ email, password })
      .expect(200);
    expect(response.body.business.id).toBe(owner.businessId);
    await request(app)
      .post('/api/v1/auth/register')
      .set('Origin', 'https://evil.invalid')
      .send({})
      .expect(403);
  });
  it('creates opening stock and a cashier with owner-only administration', async () => {
    const product = await write(owner, '/products', {
      name: 'Cooking Oil',
      sku: 'OIL',
      unit: 'bottle',
      purchaseCostMinor: '10000',
      sellingPriceMinor: '13000',
      lowStockThreshold: '5',
    }).expect(201);
    productId = product.body.id;
    const opening = {
      productId,
      quantity: '50',
      direction: 'ADD',
      type: 'OPENING',
      reason: 'Opening stock',
      idempotencyKey: randomUUID(),
    };
    const first = await write(owner, '/inventory/adjustments', opening).expect(201);
    const second = await write(owner, '/inventory/adjustments', opening).expect(201);
    expect(second.body.id).toBe(first.body.id);
    await write(owner, '/inventory/adjustments', {
      ...opening,
      idempotencyKey: randomUUID(),
    }).expect(409);
    const cashierEmail = randomUUID() + '@example.test';
    const staff = await write(owner, '/staff', {
      name: 'Test cashier',
      email: cashierEmail,
      password,
      role: 'CASHIER',
    }).expect(201);
    expect(staff.body.passwordHash).toBeUndefined();
    const response = await request(app)
      .post('/api/v1/auth/login')
      .set('Origin', origin)
      .send({ email: cashierEmail, password })
      .expect(200);
    cashier = authFrom(response);
    await write(cashier, '/staff', {
      name: 'Escalation',
      email: randomUUID() + '@example.test',
      password,
      role: 'MANAGER',
    }).expect(403);
    await write(cashier, '/inventory/adjustments', {
      ...opening,
      idempotencyKey: randomUUID(),
    }).expect(403);
    expect((await read(cashier, '/products/' + productId).expect(200)).body.quantity).toBe('50');
  });
  it('completes the required Serrekunda sale and reports exact revenue, cost, profit and remaining stock', async () => {
    const input = checkout(),
      response = await write(cashier, '/sales', input).expect(201);
    saleId = response.body.id;
    saleItemId = response.body.items[0].id;
    expect(response.body).toMatchObject({
      subtotalMinor: '39000',
      totalMinor: '39000',
      amountReceivedMinor: '50000',
      changeMinor: '11000',
      status: 'COMPLETED',
    });
    expect(response.body.items[0]).toMatchObject({
      productName: 'Cooking Oil',
      quantity: '3',
      unitPriceMinor: '13000',
      lineTotalMinor: '39000',
    });
    expect(response.body.items[0].unitCostMinor).toBeUndefined();
    expect(response.body.payments[0]).toMatchObject({
      amountMinor: '39000',
      method: 'CASH',
      verification: 'CASH_RECEIVED',
    });
    const repeated = await write(cashier, '/sales', input).expect(201);
    expect(repeated.body.id).toBe(saleId);
    await write(cashier, '/sales', { ...input, amountReceivedMinor: '60000' }).expect(409);
    expect((await read(owner, '/products/' + productId).expect(200)).body.quantity).toBe('47');
    const summary = (await read(owner, '/reports/summary').expect(200)).body;
    expect(summary).toMatchObject({
      revenueMinor: '39000',
      cogsMinor: '30000',
      grossProfitMinor: '9000',
      transactions: '1',
      valueMinor: '470000',
    });
    expect(await db.sale.count({ where: { businessId: owner.businessId } })).toBe(1);
    expect(
      await db.stockMovement.count({
        where: { businessId: owner.businessId, movementType: 'SALE' },
      }),
    ).toBe(1);
  });
  it('preserves receipt snapshots and forbids editing completed sale ledgers', async () => {
    await write(
      owner,
      '/products/' + productId,
      { name: 'Renamed oil', sellingPriceMinor: '14000' },
      'patch',
    ).expect(200);
    await write(owner, '/settings', { name: 'Renamed store' }, 'patch').expect(200);
    const sale = (await read(cashier, '/sales/' + saleId).expect(200)).body;
    expect(sale.receiptSnapshot.businessName).toBe('Demo Retail Store');
    expect(sale.items[0].productName).toBe('Cooking Oil');
    expect(sale.items[0].unitPriceMinor).toBe('13000');
    await expect(
      db.saleItem.update({ where: { id: saleItemId }, data: { productName: 'Tampered' } }),
    ).rejects.toThrow();
    await expect(
      db.sale.update({ where: { id: saleId }, data: { totalMinor: 1n } }),
    ).rejects.toThrow();
  });
  it('rejects price tampering, overselling, unauthorized discounts and unconfirmed external payments', async () => {
    await write(cashier, '/sales', { ...checkout(), totalMinor: '1' }).expect(400);
    await write(cashier, '/sales', {
      ...checkout(),
      items: [{ productId, quantity: '1000' }],
      amountReceivedMinor: '999999999',
    }).expect(409);
    await write(cashier, '/sales', {
      ...checkout(),
      discount: { type: 'PERCENT', basisPoints: 1000 },
    }).expect(403);
    await write(cashier, '/sales', { ...checkout(), paymentMethod: 'CARD' }).expect(400);
    expect(await db.sale.count({ where: { businessId: owner.businessId } })).toBe(1);
  });
  it('isolates products, inventory, sales, expenses, customers and employees between businesses', async () => {
    await read(other, '/products/' + productId).expect(404);
    await read(other, '/sales/' + saleId).expect(404);
    await write(other, '/inventory/adjustments', {
      productId,
      quantity: '1',
      direction: 'ADD',
      type: 'ADJUSTMENT',
      reason: 'Foreign',
      idempotencyKey: randomUUID(),
    }).expect(404);
    await write(other, '/staff/' + cashier.userId, { isActive: false }, 'patch').expect(404);
    const expense = await write(owner, '/expenses', {
      title: 'Electricity',
      category: 'Utilities',
      amountMinor: '1000',
      date: new Date().toISOString().slice(0, 10),
      paymentMethod: 'CASH',
    }).expect(201);
    await write(
      other,
      '/expenses/' + expense.body.id,
      {
        title: 'Foreign',
        category: 'Utilities',
        amountMinor: '1',
        date: '2026-11-10',
        paymentMethod: 'CASH',
      },
      'patch',
    ).expect(404);
    expect((await read(other, '/inventory').expect(200)).body.total).toBe(0);
    expect((await read(other, '/sales').expect(200)).body.total).toBe(0);
    expect((await read(other, '/expenses').expect(200)).body.total).toBe(0);
    const customer = await write(owner, '/customers', { name: 'Local customer' }).expect(201);
    await read(other, '/customers/' + customer.body.id + '/sales').expect(404);
    await read(cashier, '/reports/summary').expect(403);
    await read(cashier, '/expenses').expect(403);
  });
  it('records bounded returns exactly once, restores sellable stock, and updates financial summaries', async () => {
    const input = {
      idempotencyKey: randomUUID(),
      reason: 'Unopened bottle',
      refundMethod: 'CASH',
      manualConfirmation: true,
      items: [{ saleItemId, quantity: '1', restock: true }],
    };
    const first = await write(owner, '/sales/' + saleId + '/returns', input).expect(201);
    expect(first.body.refundMinor).toBe('13000');
    expect((await write(owner, '/sales/' + saleId + '/returns', input).expect(201)).body.id).toBe(
      first.body.id,
    );
    await write(owner, '/sales/' + saleId + '/returns', {
      ...input,
      idempotencyKey: randomUUID(),
      items: [{ saleItemId, quantity: '3', restock: true }],
    }).expect(409);
    expect((await read(owner, '/products/' + productId).expect(200)).body.quantity).toBe('48');
    expect((await read(owner, '/reports/summary').expect(200)).body).toMatchObject({
      revenueMinor: '39000',
      refundMinor: '13000',
      netRevenueMinor: '26000',
      cogsMinor: '20000',
      grossProfitMinor: '6000',
      expensesMinor: '1000',
      estimatedOperatingResultMinor: '5000',
    });
    await write(cashier, '/sales/' + saleId + '/returns', input).expect(403);
    const safeReceipt = (await read(cashier, '/sales/' + saleId).expect(200)).body;
    expect(safeReceipt.items[0].unitCostMinor).toBeUndefined();
    expect(safeReceipt.returns[0].items[0].costMinor).toBeUndefined();
  });
  it('records receiving atomically and detects low stock', async () => {
    const receipt = {
      idempotencyKey: randomUUID(),
      productId,
      quantity: '2',
      unitCostMinor: '10000',
      reference: 'PO-1',
    };
    const first = await write(owner, '/inventory/receipts', receipt).expect(201);
    expect((await write(owner, '/inventory/receipts', receipt).expect(201)).body.id).toBe(
      first.body.id,
    );
    expect((await read(owner, '/products/' + productId).expect(200)).body.quantity).toBe('50');
    await write(owner, '/products/' + productId, { lowStockThreshold: '50' }, 'patch').expect(200);
    expect((await read(owner, '/inventory?low=true').expect(200)).body.data[0].id).toBe(productId);
  });
  it('creates product opening stock atomically and serves validated tenant-private product images', async () => {
    const p = (
      await write(owner, '/products', {
        name: 'Photo product',
        sku: 'PHOTO',
        purchaseCostMinor: '100',
        sellingPriceMinor: '150',
        openingStock: '2.5',
      }).expect(201)
    ).body;
    expect((await read(owner, '/products/' + p.id).expect(200)).body.quantity).toBe('2.5');
    expect(
      await db.stockMovement.count({
        where: { businessId: owner.businessId, productId: p.id, referenceType: 'OPENING' },
      }),
    ).toBe(1);
    const png = Buffer.from(
      'iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAQAAAC1HAwCAAAAC0lEQVR42mP8/x8AAwMCAO+a6xkAAAAASUVORK5CYII=',
      'base64',
    );
    const upload = (auth: Auth, buffer: Buffer, type: string) =>
      request(app)
        .post('/api/v1/products/' + p.id + '/image')
        .set('Cookie', auth.cookie)
        .set('Origin', origin)
        .set('X-CSRF-Token', auth.csrf)
        .set('Content-Type', type)
        .send(buffer);
    await upload(owner, Buffer.from('<svg><script>alert(1)</script></svg>'), 'image/png').expect(
      400,
    );
    await upload(cashier, png, 'image/png').expect(403);
    await upload(other, png, 'image/png').expect(404);
    const uploaded = await upload(owner, png, 'image/png').expect(201);
    expect(uploaded.body.imageKey).toMatch(/^[a-f0-9-]{36}\.png$/);
    expect(
      (await read(owner, '/products/' + p.id + '/image').expect(200)).headers['content-type'],
    ).toContain('image/png');
    await read(other, '/products/' + p.id + '/image').expect(404);
    await upload(owner, Buffer.alloc(2 * 1024 * 1024 + 1), 'image/png').expect(413);
  });
  it('deduplicates concurrent identical checkouts and records external payment confirmation honestly', async () => {
    const input = {
      ...checkout('1'),
      paymentMethod: 'CARD',
      amountReceivedMinor: '14000',
      manualConfirmation: true,
      paymentReference: 'TERMINAL-MANUAL-1',
    };
    const results = await Promise.all([
      write(cashier, '/sales', input),
      write(cashier, '/sales', input),
    ]);
    expect(results.map((r) => r.status)).toEqual([201, 201]);
    expect(results[0].body.id).toBe(results[1].body.id);
    expect(results[0].body.payments[0].verification).toBe('MANUAL_RECORD');
    expect(
      await db.sale.count({
        where: { businessId: owner.businessId, idempotencyKey: input.idempotencyKey },
      }),
    ).toBe(1);
    expect(
      await db.stockMovement.count({
        where: { businessId: owner.businessId, referenceId: results[0].body.id },
      }),
    ).toBe(1);
  });
  it('allocates discounted fractional refunds and reversed costs without losing minor units', async () => {
    const p = (
      await write(owner, '/products', {
        name: 'Fractional product',
        sku: 'FRACTION',
        purchaseCostMinor: '101',
        sellingPriceMinor: '201',
        openingStock: '1',
      }).expect(201)
    ).body;
    const sale = (
      await write(owner, '/sales', {
        idempotencyKey: randomUUID(),
        items: [{ productId: p.id, quantity: '1' }],
        paymentMethod: 'CASH',
        amountReceivedMinor: '200',
        discount: { type: 'FIXED', amountMinor: '1' },
      }).expect(201)
    ).body;
    expect(sale.items[0].discountMinor).toBe('1');
    const refunds = [];
    for (let i = 0; i < 2; i++)
      refunds.push(
        (
          await write(owner, '/sales/' + sale.id + '/returns', {
            idempotencyKey: randomUUID(),
            reason: 'Fractional return',
            refundMethod: 'CASH',
            manualConfirmation: true,
            items: [{ saleItemId: sale.items[0].id, quantity: '0.5', restock: true }],
          }).expect(201)
        ).body,
      );
    expect(refunds.map((r) => r.refundMinor)).toEqual(['100', '100']);
    expect(refunds.reduce((s, r) => s + BigInt(r.items[0].costMinor), 0n)).toBe(101n);
    expect((await read(owner, '/products/' + p.id).expect(200)).body.quantity).toBe('1');
    const csv = await read(owner, '/reports/export?kind=gross-profit').expect(200);
    expect(csv.text).toContain('grossProfitMinor');
  });
  it('permits only one of two concurrent checkouts for the last item and rolls back every other write', async () => {
    const p = (
      await write(owner, '/products', {
        name: 'Last item',
        sku: 'LAST',
        purchaseCostMinor: '50',
        sellingPriceMinor: '100',
      }).expect(201)
    ).body;
    await write(owner, '/inventory/adjustments', {
      productId: p.id,
      quantity: '1',
      direction: 'ADD',
      type: 'OPENING',
      reason: 'Last item test',
      idempotencyKey: randomUUID(),
    }).expect(201);
    const sell = () =>
      write(cashier, '/sales', {
        idempotencyKey: randomUUID(),
        items: [{ productId: p.id, quantity: '1' }],
        paymentMethod: 'CASH',
        amountReceivedMinor: '100',
      });
    const results = await Promise.all([sell(), sell()]);
    expect(results.map((r) => r.status).sort()).toEqual([201, 409]);
    expect(
      (
        await db.stockLevel.findFirstOrThrow({
          where: { businessId: owner.businessId, productId: p.id },
        })
      ).quantity.toString(),
    ).toBe('0');
    expect(
      await db.saleItem.count({ where: { businessId: owner.businessId, productId: p.id } }),
    ).toBe(1);
    expect(
      await db.stockMovement.count({
        where: { businessId: owner.businessId, productId: p.id, movementType: 'SALE' },
      }),
    ).toBe(1);
  });
  it('exports tenant data as CSV and revokes changed employee access', async () => {
    await expect(
      db.expense.create({
        data: {
          businessId: owner.businessId,
          actorId: other.userId,
          title: 'Invalid actor',
          category: 'Test',
          amountMinor: 1n,
          date: new Date(),
          paymentMethod: 'CASH',
        },
      }),
    ).rejects.toMatchObject({ code: 'P2003' });
    const response = await read(owner, '/reports/export?kind=sales').expect(200);
    expect(response.headers['content-type']).toContain('text/csv');
    expect(response.text).toContain('39000');
    expect((await read(other, '/reports/export?kind=sales').expect(200)).text).not.toContain(
      '39000',
    );
    await write(owner, '/staff/' + cashier.userId, { isActive: false }, 'patch').expect(200);
    await read(cashier, '/sales').expect(401);
  });
});
