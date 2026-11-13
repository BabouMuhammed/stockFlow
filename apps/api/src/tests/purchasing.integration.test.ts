import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import request from 'supertest';
import { PrismaClient } from '@prisma/client';
import { randomBytes, randomUUID } from 'node:crypto';
import { execFileSync } from 'node:child_process';
import { resolve } from 'node:path';
import { createApp } from '../app';

const url = process.env.TEST_DATABASE_URL,
  suite = url ? describe : describe.skip;
const origin = 'http://localhost:5173',
  password = randomBytes(24).toString('hex');
type Auth = { cookie: string; csrf: string; businessId: string };
let db: PrismaClient, app: ReturnType<typeof createApp>, owner: Auth, other: Auth, cashier: Auth;
let supplierId: string, products: string[], legacyId: string;
const today = () => new Date().toISOString().slice(0, 10);
const auth = (r: request.Response): Auth => ({
  cookie: String(r.headers['set-cookie'][0]).split(';')[0],
  csrf: r.body.csrfToken,
  businessId: r.body.business.id,
});
const post = (user: Auth, path: string, data: unknown) =>
  request(app)
    .post('/api/v1' + path)
    .set('Cookie', user.cookie)
    .set('Origin', origin)
    .set('X-CSRF-Token', user.csrf)
    .send(data);
const get = (user: Auth, path: string) =>
  request(app)
    .get('/api/v1' + path)
    .set('Cookie', user.cookie);
const receiptBody = (quantity = '1') => ({
  supplierId,
  reference: 'INV-' + randomUUID(),
  receivedDate: today(),
  items: [{ productId: products[0], quantity, unitCostMinor: '10000' }],
  idempotencyKey: randomUUID(),
});
const paymentBody = (amountMinor: string) => ({
  amountMinor,
  date: today(),
  method: 'CASH',
  confirmed: true,
  idempotencyKey: randomUUID(),
});
const newReceipt = async (quantity = '1') =>
  (await post(owner, '/inventory/receipts', receiptBody(quantity)).expect(201)).body;
const balance = async (id: string) =>
  (await get(owner, '/inventory/receipts/' + id).expect(200)).body;
suite('supplier purchasing on isolated PostgreSQL', () => {
  beforeAll(async () => {
    const target = new URL(url!);
    if (
      !['localhost', '127.0.0.1', '[::1]'].includes(target.hostname) ||
      !/^\/stockflow_test[a-z0-9_]*$/.test(target.pathname)
    )
      throw new Error('Dedicated local test database required');
    if (process.env.DATABASE_URL) {
      const main = new URL(process.env.DATABASE_URL);
      if (main.host === target.host && main.pathname === target.pathname)
        throw new Error('Refusing development database');
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
    const register = async () => {
      const result = await request(app)
        .post('/api/v1/auth/register')
        .set('Origin', origin)
        .send({
          businessName: 'Purchasing test',
          name: 'Owner',
          email: randomUUID() + '@example.test',
          phone: '12345678',
          password,
          passwordConfirmation: password,
        })
        .expect(201);
      const user = auth(result);
      await db.business.update({ where: { id: user.businessId }, data: { isDemo: true } });
      return user;
    };
    owner = await register();
    other = await register();
    supplierId = (await post(owner, '/suppliers', { name: 'ABC Distributors' }).expect(201)).body
      .id;
    products = [];
    for (const name of ['Cooking oil', 'Rice', 'Soft drinks'])
      products.push(
        (
          await post(owner, '/products', {
            name,
            purchaseCostMinor: '10000',
            sellingPriceMinor: '25000',
          }).expect(201)
        ).body.id,
      );
    const cashierEmail = randomUUID() + '@example.test';
    await post(owner, '/staff', {
      name: 'Cashier',
      email: cashierEmail,
      password,
      role: 'CASHIER',
    }).expect(201);
    cashier = auth(
      await request(app)
        .post('/api/v1/auth/login')
        .set('Origin', origin)
        .send({ email: cashierEmail, password })
        .expect(200),
    );
    const branch = await db.branch.findFirstOrThrow({
      where: { businessId: owner.businessId, code: 'MAIN' },
    });
    legacyId = (
      await db.stockReceipt.create({
        data: {
          businessId: owner.businessId,
          branchId: branch.id,
          supplierId,
          supplierName: 'Historical name',
          reference: 'LEGACY',
          idempotencyKey: randomUUID(),
          items: {
            create: {
              productId: products[0],
              productName: 'Historical oil',
              quantity: '1',
              unitCostMinor: 5000n,
            },
          },
        },
      })
    ).id;
  });
  afterAll(async () => {
    await db?.$disconnect();
  });
  it('retains historical receipts as unreconciled, not confirmed debt', async () => {
    expect(await balance(legacyId)).toMatchObject({
      totalMinor: '5000',
      paidMinor: '0',
      outstandingMinor: null,
      paymentStatus: 'UNRECONCILED',
    });
    const summary = (await get(owner, '/suppliers/' + supplierId + '/financial').expect(200)).body;
    expect(summary).toMatchObject({
      outstandingSupplierMinor: '0',
      unreconciledPurchases: '1',
      unreconciledPurchaseMinor: '5000',
    });
  });
  it('preserves accessible legacy references and detects duplicate legacy supplier documents', async () => {
    const old = await balance(legacyId);
    expect(old).toMatchObject({
      reference: 'LEGACY',
      internalReference: null,
      supplierInvoiceReference: null,
    });
    const body = { ...receiptBody(), reference: undefined };
    await post(owner, '/inventory/receipts', {
      ...body,
      supplierInvoiceReference: 'legacy',
    }).expect(409);
    expect(
      (await get(owner, '/inventory/receipts?search=LEGACY').expect(200)).body.data.some(
        (r: { id: string }) => r.id === legacyId,
      ),
    ).toBe(true);
  });
  it('generates safe concurrent codes without supplier invoices, independently of idempotency', async () => {
    const base = { ...receiptBody(), reference: undefined };
    const product = (
      await post(owner, '/products', {
        name: 'Concurrent receiving fixture',
        purchaseCostMinor: '10000',
        sellingPriceMinor: '15000',
      }).expect(201)
    ).body;
    const bodies = Array.from({ length: 4 }, () => ({
      ...base,
      items: [{ ...base.items[0], productId: product.id }],
      idempotencyKey: randomUUID(),
    }));
    const results = await Promise.all(bodies.map((b) => post(owner, '/inventory/receipts', b)));
    expect(results.map((r) => r.status)).toEqual([201, 201, 201, 201]);
    const codes = results.map((r) => r.body.internalReference);
    expect(new Set(codes).size).toBe(4);
    for (const r of results) {
      expect(r.body.reference).toMatch(/^SR-\d{6,}$/);
      expect(r.body.supplierInvoiceReference).toBeNull();
      expect(r.body.internalReference).toBe(r.body.reference);
    }
    const replay = (await post(owner, '/inventory/receipts', bodies[0]).expect(201)).body;
    expect(replay.id).toBe(results[0].body.id);
    expect(replay.internalReference).toBe(codes[0]);
    expect((await get(owner, '/products/' + product.id).expect(200)).body.quantity).toBe('4');
    await expect(
      db.stockReceipt.update({
        where: { id: replay.id },
        data: { reference: 'CHANGED', internalReference: 'CHANGED' },
      }),
    ).rejects.toThrow();
  });
  it('separates invoice references, checks supplier scope, and audits explained partial deliveries', async () => {
    const base = { ...receiptBody(), reference: undefined };
    const product = (
      await post(owner, '/products', {
        name: 'Invoice receiving fixture',
        purchaseCostMinor: '10000',
        sellingPriceMinor: '15000',
      }).expect(201)
    ).body;
    const body = {
      ...base,
      items: [{ ...base.items[0], productId: product.id }],
      supplierInvoiceReference: 'DOC-' + randomUUID(),
    };
    const first = (await post(owner, '/inventory/receipts', body).expect(201)).body;
    expect(first.supplierInvoiceReference).toBe(body.supplierInvoiceReference);
    expect(first.internalReference).not.toBe(body.supplierInvoiceReference);
    await post(owner, '/inventory/receipts', { ...body, idempotencyKey: randomUUID() }).expect(409);
    const reason = 'Partial delivery for remaining cartons';
    const partial = (
      await post(owner, '/inventory/receipts', {
        ...body,
        idempotencyKey: randomUUID(),
        repeatReferenceReason: reason,
      }).expect(201)
    ).body;
    expect(partial.internalReference).not.toBe(first.internalReference);
    const audit = await db.auditLog.findFirstOrThrow({
      where: { businessId: owner.businessId, entityId: partial.id, action: 'STOCK_RECEIVE' },
    });
    expect(audit.metadata).toMatchObject({
      supplierInvoiceReference: body.supplierInvoiceReference,
      repeatReferenceReason: reason,
    });
    const another = (
      await post(owner, '/suppliers', { name: 'Second reference supplier' }).expect(201)
    ).body;
    await post(owner, '/inventory/receipts', {
      ...body,
      supplierId: another.id,
      idempotencyKey: randomUUID(),
    }).expect(201);
    expect((await get(owner, '/products/' + product.id).expect(200)).body.quantity).toBe('3');
  });
  it('receives multiple products atomically, preserves costs and derives the D9,500 total', async () => {
    const body = {
      ...receiptBody(),
      items: [
        { productId: products[0], quantity: '20', unitCostMinor: '15000' },
        { productId: products[1], quantity: '10', unitCostMinor: '45000' },
        { productId: products[2], quantity: '50', unitCostMinor: '4000' },
      ],
    };
    const before = await db.expense.count({ where: { businessId: owner.businessId } });
    const [a, b] = await Promise.all([
      post(owner, '/inventory/receipts', body),
      post(owner, '/inventory/receipts', body),
    ]);
    expect(a.status).toBe(201);
    expect(b.status).toBe(201);
    expect(a.body.id).toBe(b.body.id);
    expect(a.body).toMatchObject({
      totalMinor: '950000',
      paymentStatus: 'UNPAID',
      outstandingMinor: '950000',
    });
    expect(a.body.items.map((i: { lineTotalMinor: string }) => i.lineTotalMinor).sort()).toEqual([
      '200000',
      '300000',
      '450000',
    ]);
    for (const [index, quantity] of ['20', '10', '50'].entries())
      expect((await get(owner, '/products/' + products[index]).expect(200)).body.quantity).toBe(
        quantity,
      );
    expect(
      await db.stockMovement.count({
        where: { businessId: owner.businessId, referenceId: a.body.id },
      }),
    ).toBe(3);
    expect(await db.expense.count({ where: { businessId: owner.businessId } })).toBe(before);
    expect((await balance(a.body.id)).totalMinor).toBe('950000');
    await post(owner, '/inventory/receipts', { ...body, notes: 'Changed request' }).expect(409);
  });
  it('keeps the legacy single-product request and rounds fractional line costs half up', async () => {
    const body = {
      productId: products[0],
      quantity: '0.5',
      unitCostMinor: '101',
      reference: randomUUID(),
      idempotencyKey: randomUUID(),
    };
    const r = (await post(owner, '/inventory/receipts', body).expect(201)).body;
    expect(r.totalMinor).toBe('51');
    expect(r.paymentStatus).toBe('UNRECONCILED');
  });
  it('rejects invalid products, suppliers, costs, quantities and untrusted totals without writes', async () => {
    const count = await db.stockReceipt.count({ where: { businessId: owner.businessId } });
    const body = receiptBody();
    await post(owner, '/inventory/receipts', { ...body, supplierId: randomUUID() }).expect(404);
    await post(owner, '/inventory/receipts', {
      ...body,
      items: [...body.items, { productId: randomUUID(), quantity: '1', unitCostMinor: '1' }],
    }).expect(404);
    for (const change of [
      { quantity: '-1' },
      { quantity: '0' },
      { quantity: '1.0001' },
      { unitCostMinor: '-1' },
    ])
      await post(owner, '/inventory/receipts', {
        ...body,
        items: [{ ...body.items[0], ...change }],
      }).expect(400);
    await post(owner, '/inventory/receipts', { ...body, totalMinor: '1' }).expect(400);
    await post(owner, '/inventory/receipts', {
      ...body,
      items: [body.items[0], body.items[0]],
    }).expect(400);
    expect(await db.stockReceipt.count({ where: { businessId: owner.businessId } })).toBe(count);
  });
  it('rolls back all receipt items and earlier stock writes if a later stock increment overflows', async () => {
    const sorted = [...products].sort();
    const last = sorted[sorted.length - 1],
      first = sorted[0];
    const branch = await db.branch.findFirstOrThrow({
      where: { businessId: owner.businessId, code: 'MAIN' },
    });
    const stock = await db.stockLevel.findUniqueOrThrow({
      where: {
        businessId_branchId_productId: {
          businessId: owner.businessId,
          branchId: branch.id,
          productId: last,
        },
      },
    });
    const before = await db.stockLevel.findFirstOrThrow({
      where: { businessId: owner.businessId, productId: first },
    });
    await db.stockLevel.update({
      where: { id: stock.id },
      data: { quantity: '999999999999999.999' },
    });
    const body = {
      ...receiptBody(),
      items: sorted.map((productId) => ({ productId, quantity: '1', unitCostMinor: '10' })),
    };
    try {
      expect((await post(owner, '/inventory/receipts', body)).status).toBeGreaterThanOrEqual(400);
      expect(
        await db.stockReceipt.count({
          where: { businessId: owner.businessId, idempotencyKey: body.idempotencyKey },
        }),
      ).toBe(0);
      expect(
        (await db.stockLevel.findUniqueOrThrow({ where: { id: before.id } })).quantity.toString(),
      ).toBe(before.quantity.toString());
    } finally {
      await db.stockLevel.update({ where: { id: stock.id }, data: { quantity: stock.quantity } });
    }
  });
  it('detects duplicate invoice references but allows explained repeat deliveries', async () => {
    const body = receiptBody();
    await post(owner, '/inventory/receipts', body).expect(201);
    await post(owner, '/inventory/receipts', { ...body, idempotencyKey: randomUUID() }).expect(409);
    await post(owner, '/inventory/receipts', {
      ...body,
      idempotencyKey: randomUUID(),
      repeatReferenceReason: 'Second delivery against this invoice',
    }).expect(201);
  });
  it('tracks multiple partial payments and full settlement without creating operating expenses', async () => {
    const r = await newReceipt('120');
    const first = paymentBody('700000');
    const before = await db.expense.count({ where: { businessId: owner.businessId } });
    const a = await post(owner, '/inventory/receipts/' + r.id + '/payments', first).expect(201);
    expect(
      (await post(owner, '/inventory/receipts/' + r.id + '/payments', first).expect(201)).body.id,
    ).toBe(a.body.id);
    await post(owner, '/inventory/receipts/' + r.id + '/payments', paymentBody('300000')).expect(
      201,
    );
    expect(await balance(r.id)).toMatchObject({
      paidMinor: '1000000',
      outstandingMinor: '200000',
      paymentStatus: 'PARTIALLY_PAID',
    });
    await post(owner, '/inventory/receipts/' + r.id + '/payments', paymentBody('200000')).expect(
      201,
    );
    const full = await balance(r.id);
    expect(full.paymentStatus).toBe('PAID');
    expect(full.payments).toHaveLength(3);
    expect(await db.expense.count({ where: { businessId: owner.businessId } })).toBe(before);
  });
  it('rejects zero, negative, excess and unconfirmed payments and leaves balances unchanged', async () => {
    const r = await newReceipt();
    for (const amount of ['0', '-1', '10001', '1.5'])
      await post(owner, '/inventory/receipts/' + r.id + '/payments', paymentBody(amount)).expect(
        400,
      );
    await post(owner, '/inventory/receipts/' + r.id + '/payments', {
      ...paymentBody('1'),
      confirmed: false,
    }).expect(400);
    await post(owner, '/inventory/receipts/' + r.id + '/payments', {
      ...paymentBody('1'),
      method: 'BANK_TRANSFER',
    }).expect(400);
    expect((await balance(r.id)).paidMinor).toBe('0');
  });
  it('prevents concurrent overpayment and concurrent duplicate submissions', async () => {
    const r = await newReceipt(),
      path = '/inventory/receipts/' + r.id + '/payments';
    const results = await Promise.all([
      post(owner, path, paymentBody('7000')),
      post(owner, path, paymentBody('7000')),
    ]);
    expect(results.map((r) => r.status).sort()).toEqual([201, 400]);
    const body = paymentBody('3000');
    const duplicate = await Promise.all([post(owner, path, body), post(owner, path, body)]);
    expect(duplicate.map((r) => r.status)).toEqual([201, 201]);
    expect(duplicate[0].body.id).toBe(duplicate[1].body.id);
    expect((await balance(r.id)).payments).toHaveLength(2);
    expect((await balance(r.id)).paidMinor).toBe('10000');
  });
  it('enforces tenant, role, CSRF and receipt ownership restrictions', async () => {
    const r = await newReceipt(),
      path = '/inventory/receipts/' + r.id + '/payments';
    await post(other, path, paymentBody('1')).expect(404);
    await get(other, '/inventory/receipts/' + r.id).expect(404);
    await get(other, '/suppliers/' + supplierId + '/financial').expect(404);
    await post(cashier, path, paymentBody('1')).expect(403);
    await get(cashier, '/suppliers/' + supplierId + '/financial').expect(403);
    await request(app)
      .post('/api/v1' + path)
      .set('Cookie', owner.cookie)
      .set('Origin', origin)
      .send(paymentBody('1'))
      .expect(403);
    const foreign = (await post(other, '/suppliers', { name: 'Other supplier' }).expect(201)).body;
    await post(owner, '/inventory/receipts', { ...receiptBody(), supplierId: foreign.id }).expect(
      404,
    );
    await expect(
      db.supplierPayment.create({
        data: {
          businessId: owner.businessId,
          receiptId: r.id,
          supplierId: foreign.id,
          actorId: (
            await db.user.findFirstOrThrow({
              where: { businessId: owner.businessId, role: 'OWNER' },
            })
          ).id,
          amountMinor: 1n,
          method: 'CASH',
          date: new Date(),
          idempotencyKey: randomUUID(),
          requestHash: 'bad',
        },
      }),
    ).rejects.toThrow();
  });
  it('reverses entries auditably without deletion and prevents double reversal', async () => {
    const r = await newReceipt(),
      p = (
        await post(owner, '/inventory/receipts/' + r.id + '/payments', paymentBody('10000')).expect(
          201,
        )
      ).body;
    const input = {
      date: today(),
      reason: 'Mistaken duplicate bank entry',
      confirmed: true,
      idempotencyKey: randomUUID(),
    };
    const reversal = (
      await post(owner, '/inventory/payments/' + p.id + '/reverse', input).expect(201)
    ).body;
    expect(
      (await post(owner, '/inventory/payments/' + p.id + '/reverse', input).expect(201)).body.id,
    ).toBe(reversal.id);
    await post(owner, '/inventory/payments/' + p.id + '/reverse', {
      ...input,
      idempotencyKey: randomUUID(),
    }).expect(409);
    expect(await balance(r.id)).toMatchObject({ paidMinor: '0', outstandingMinor: '10000' });
    expect((await balance(r.id)).payments).toHaveLength(2);
    await expect(db.supplierPayment.delete({ where: { id: p.id } })).rejects.toThrow();
    await expect(
      db.supplierPayment.update({ where: { id: p.id }, data: { amountMinor: 2n } }),
    ).rejects.toThrow();
  });
  it('requires explicit owner reconciliation before historical balances become debt', async () => {
    await post(owner, '/inventory/receipts/' + legacyId + '/payments', paymentBody('2000')).expect(
      201,
    );
    expect((await balance(legacyId)).paymentStatus).toBe('UNRECONCILED');
    const body = {
      reason: 'Original invoice and all payment slips checked',
      confirmAllPaymentsRecorded: true,
      idempotencyKey: randomUUID(),
    };
    await post(owner, '/inventory/receipts/' + legacyId + '/reconcile', {
      ...body,
      confirmAllPaymentsRecorded: false,
    }).expect(400);
    await post(owner, '/inventory/receipts/' + legacyId + '/reconcile', body).expect(200);
    await post(owner, '/inventory/receipts/' + legacyId + '/reconcile', body).expect(200);
    expect(await balance(legacyId)).toMatchObject({
      outstandingMinor: '3000',
      paymentStatus: 'PARTIALLY_PAID',
    });
    expect(
      await db.auditLog.count({
        where: {
          businessId: owner.businessId,
          entityId: legacyId,
          action: 'SUPPLIER_RECEIPT_RECONCILE',
        },
      }),
    ).toBe(1);
  });
  it('reports purchases by receipt date and payments by payment date, without reducing profit twice', async () => {
    const body = { ...receiptBody('3'), receivedDate: '2026-01-05' };
    const r = (await post(owner, '/inventory/receipts', body).expect(201)).body;
    const p = { ...paymentBody('20000'), date: '2026-01-07' };
    await post(owner, '/inventory/receipts/' + r.id + '/payments', p).expect(201);
    const before = (await get(owner, '/reports/summary?from=2026-01-05&to=2026-01-05').expect(200))
      .body;
    expect(before).toMatchObject({
      purchasesMinor: '30000',
      supplierPaymentsMinor: '0',
      expensesMinor: '0',
      estimatedOperatingResultMinor: '0',
      balanceBasis: 'CURRENT',
    });
    expect(
      (await get(owner, '/reports/summary?from=2026-01-07&to=2026-01-07').expect(200)).body
        .supplierPaymentsMinor,
    ).toBe('20000');
    expect(
      (
        await get(owner, '/inventory/receipts?from=2026-01-05&to=2026-01-05').expect(200)
      ).body.data.map((v: { id: string }) => v.id),
    ).toEqual([r.id]);
    await get(owner, '/inventory/receipts?from=2026-01-07&to=2026-01-05').expect(400);
    const refresh = (await get(owner, '/reports/summary?from=2026-01-05&to=2026-01-05').expect(200))
      .body;
    expect(refresh).toEqual(before);
    const saved = await db.supplierPayment.findMany({
      where: { receiptId: r.id, businessId: owner.businessId },
    });
    expect(saved.reduce((s, p) => s + p.amountMinor, 0n)).toBe(20000n);
    const purchases = await get(
      owner,
      '/reports/export?kind=purchases&from=2026-01-05&to=2026-01-05',
    ).expect(200);
    expect(purchases.text).toContain('30000');
    expect(purchases.text).toContain(r.reference);
    const payments = await get(
      owner,
      '/reports/export?kind=supplier-payments&from=2026-01-07&to=2026-01-07',
    ).expect(200);
    expect(payments.text).toContain('20000');
    expect(payments.text).toContain(r.reference);
  });
  it('preserves POS, historical sale costs, archived stock valuation and net-return report consistency', async () => {
    const r = await newReceipt('5');
    const sale = (
      await post(owner, '/sales', {
        idempotencyKey: randomUUID(),
        items: [{ productId: products[0], quantity: '2' }],
        paymentMethod: 'CASH',
        exactPayment: true,
      }).expect(201)
    ).body;
    const originalCost = sale.items[0].unitCostMinor;
    await post(owner, '/inventory/receipts', {
      ...receiptBody(),
      items: [{ productId: products[0], quantity: '1', unitCostMinor: '20000' }],
    }).expect(201);
    expect((await get(owner, '/sales/' + sale.id).expect(200)).body.items[0].unitCostMinor).toBe(
      originalCost,
    );
    await post(owner, '/sales/' + sale.id + '/returns', {
      idempotencyKey: randomUUID(),
      reason: 'One item returned',
      refundMethod: 'CASH',
      manualConfirmation: true,
      items: [{ saleItemId: sale.items[0].id, quantity: '1', restock: true }],
    }).expect(201);
    const report = (await get(owner, '/reports/summary').expect(200)).body;
    expect(report).toMatchObject({
      netRevenueMinor: '25000',
      cogsMinor: originalCost,
      grossProfitMinor: String(25000n - BigInt(originalCost)),
    });
    expect(
      report.trends.reduce((s: bigint, t: { costMinor: string }) => s + BigInt(t.costMinor), 0n),
    ).toBe(BigInt(report.cogsMinor));
    expect(
      report.bestProducts.reduce(
        (s: bigint, t: { costMinor: string }) => s + BigInt(t.costMinor),
        0n,
      ),
    ).toBe(BigInt(report.cogsMinor));
    const value = report.valueMinor;
    await request(app)
      .patch('/api/v1/products/' + products[0])
      .set('Cookie', owner.cookie)
      .set('Origin', origin)
      .set('X-CSRF-Token', owner.csrf)
      .send({ isActive: false })
      .expect(200);
    expect((await get(owner, '/reports/summary').expect(200)).body.valueMinor).toBe(value);
    const inventory = await get(owner, '/reports/export?kind=inventory').expect(200);
    expect(inventory.text).toContain('Cooking oil');
    const productReport = await get(owner, '/reports/export?kind=products').expect(200);
    expect(productReport.text).toContain('after restocked returns');
    expect((await balance(r.id)).totalMinor).toBe('50000');
  });
  it('rejects obvious purchase expense classification while retaining legitimate expenses', async () => {
    const body = {
      title: 'Shop running cost',
      category: 'Inventory purchases',
      amountMinor: '1000',
      date: today(),
      paymentMethod: 'CASH',
    };
    await post(owner, '/expenses', body).expect(400);
    await post(owner, '/expenses', { ...body, category: 'Rent' }).expect(201);
  });
});
