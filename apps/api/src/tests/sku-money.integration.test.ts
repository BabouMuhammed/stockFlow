import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import request from 'supertest';
import { PrismaClient } from '@prisma/client';
import { randomBytes, randomUUID } from 'node:crypto';
import { execFileSync } from 'node:child_process';
import { resolve } from 'node:path';
import { createApp } from '../app';
const url = process.env.TEST_DATABASE_URL,
  suite = url ? describe : describe.skip,
  origin = 'http://localhost:5173';
type Auth = { cookie: string; csrf: string; businessId: string };
let db: PrismaClient,
  app: ReturnType<typeof createApp>,
  owner: Auth,
  other: Auth,
  firstProduct: { id: string; sku: string };
const product = (name = 'Product') => ({
  name,
  purchaseCostMinor: '100',
  sellingPriceMinor: '150',
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
suite('generated SKUs and exact checkout against PostgreSQL', () => {
  beforeAll(async () => {
    const target = new URL(url!);
    if (
      !['localhost', '127.0.0.1', '[::1]'].includes(target.hostname) ||
      !/^\/stockflow_test[a-z0-9_]*$/.test(target.pathname)
    )
      throw new Error('Separate local test database required');
    if (process.env.DATABASE_URL) {
      const main = new URL(process.env.DATABASE_URL);
      if (main.host === target.host && main.pathname === target.pathname)
        throw new Error('Test database must differ from application database');
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
      const password = randomBytes(24).toString('hex');
      const response = await request(app)
        .post('/api/v1/auth/register')
        .set('Origin', origin)
        .send({
          businessName: 'SKU and money test',
          name: 'Test owner',
          email: randomUUID() + '@example.test',
          phone: '+220 7000000',
          password,
          passwordConfirmation: password,
        })
        .expect(201);
      await db.business.update({
        where: { id: response.body.business.id },
        data: { isDemo: true },
      });
      return {
        cookie: String(response.headers['set-cookie'][0]).split(';')[0],
        csrf: response.body.csrfToken,
        businessId: response.body.business.id,
      };
    };
    owner = await register();
    other = await register();
  }, 60000);
  afterAll(async () => {
    await db?.$disconnect();
  });
  it('generates business-local sequential SKUs and keeps barcode independent', async () => {
    firstProduct = (
      await write(owner, '/products', { ...product('First'), barcode: 'BARCODE-123' }).expect(201)
    ).body;
    expect(firstProduct.sku).toBe('PRD-000001');
    expect((await write(owner, '/products', product('Second')).expect(201)).body.sku).toBe(
      'PRD-000002',
    );
    expect((await write(other, '/products', product('Other business')).expect(201)).body.sku).toBe(
      'PRD-000001',
    );
    expect((await read(owner, '/products/' + firstProduct.id).expect(200)).body.barcode).toBe(
      'BARCODE-123',
    );
  });
  it('validates custom SKUs per business and skips existing custom codes during automatic generation', async () => {
    const custom = (
      await write(owner, '/products', { ...product('Custom'), sku: ' PRD-000003 ' }).expect(201)
    ).body;
    expect(custom.sku).toBe('PRD-000003');
    expect(
      (await write(owner, '/products', { ...product('Next'), sku: '' }).expect(201)).body.sku,
    ).toBe('PRD-000004');
    await write(owner, '/products', { ...product('Duplicate'), sku: custom.sku }).expect(409);
    await write(other, '/products', {
      ...product('Same custom code, different tenant'),
      sku: custom.sku,
    }).expect(201);
    await write(owner, '/products/' + firstProduct.id, { sku: custom.sku }, 'patch').expect(409);
  });
  it('prevents duplicate SKUs during concurrent automatic and custom creation', async () => {
    const auto = await Promise.all(
      Array.from({ length: 8 }, (_, i) => write(owner, '/products', product('Concurrent ' + i))),
    );
    expect(auto.map((r) => r.status)).toEqual(Array(8).fill(201));
    expect(new Set(auto.map((r) => r.body.sku)).size).toBe(8);
    const custom = await Promise.all(
      Array.from({ length: 4 }, () =>
        write(owner, '/products', { ...product('Concurrent custom'), sku: 'OWN-CODE' }),
      ),
    );
    expect(custom.map((r) => r.status).sort()).toEqual([201, 409, 409, 409]);
    const [counter] = await db.$queryRaw<
      Array<{ nextValue: bigint }>
    >`SELECT "nextValue" FROM "ProductSkuCounter" WHERE "businessId"=${owner.businessId}::uuid`;
    const candidate = 'PRD-' + counter.nextValue.toString().padStart(6, '0');
    const [generated, competing] = await Promise.all([
      write(owner, '/products', product('Automatic race')),
      write(owner, '/products', { ...product('Custom race'), sku: candidate }),
    ]);
    expect(generated.status).toBe(201);
    expect([201, 409]).toContain(competing.status);
    if (competing.status === 201) expect(generated.body.sku).not.toBe(competing.body.sku);
  });
  it('preserves SKUs on name/category edits and exposes them to inventory and POS searches', async () => {
    const category = (await write(owner, '/categories', { name: 'New category' }).expect(201)).body;
    const changed = (
      await write(
        owner,
        '/products/' + firstProduct.id,
        { name: 'Renamed product', categoryId: category.id },
        'patch',
      ).expect(200)
    ).body;
    expect(changed.sku).toBe(firstProduct.sku);
    expect(changed.barcode).toBe('BARCODE-123');
    expect((await read(owner, '/inventory?search=Renamed').expect(200)).body.data[0].sku).toBe(
      firstProduct.sku,
    );
    expect(
      (await read(owner, '/products?search=' + firstProduct.sku).expect(200)).body.data[0].id,
    ).toBe(firstProduct.id);
  });
  let pennyId: string;
  it.each([
    ['390', '39000'],
    ['390.5', '39050'],
    ['390.50', '39050'],
    ['1000', '100000'],
    ['1000.75', '100075'],
    ['0.01', '1'],
  ])('records a natural payment of %s exactly', async (amount, expected) => {
    if (!pennyId)
      pennyId = (
        await write(owner, '/products', {
          ...product('Penny'),
          sellingPriceMinor: '1',
          purchaseCostMinor: '0',
          openingStock: '100',
        }).expect(201)
      ).body.id;
    const sale = (
      await write(owner, '/sales', {
        idempotencyKey: randomUUID(),
        items: [{ productId: pennyId, quantity: '1' }],
        paymentMethod: 'CASH',
        amountReceived: amount,
      }).expect(201)
    ).body;
    expect(sale.amountReceivedMinor).toBe(expected);
    expect(sale.totalMinor).toBe('1');
    expect(sale.changeMinor).toBe((BigInt(expected) - 1n).toString());
    const stored = await db.sale.findUniqueOrThrow({
      where: { id: sale.id },
      include: { payments: true },
    });
    expect(stored.amountReceivedMinor).toBe(BigInt(expected));
    expect(stored.payments[0].amountMinor).toBe(stored.totalMinor);
  });
  it('records 0.10 + 0.20 as exactly 0.30', async () => {
    const ids = [];
    for (const price of ['10', '20'])
      ids.push(
        (
          await write(owner, '/products', {
            ...product('Small amount'),
            purchaseCostMinor: '0',
            sellingPriceMinor: price,
            openingStock: '1',
          }).expect(201)
        ).body.id,
      );
    const sale = (
      await write(owner, '/sales', {
        idempotencyKey: randomUUID(),
        items: ids.map((productId) => ({ productId, quantity: '1' })),
        paymentMethod: 'CASH',
        amountReceived: '0.30',
      }).expect(201)
    ).body;
    expect(sale.subtotalMinor).toBe('30');
    expect(sale.totalMinor).toBe('30');
    expect(sale.changeMinor).toBe('0');
  });
  it('persists D661.25 with D700 received and D38.75 change across API/client restarts', async () => {
    const p = (
      await write(owner, '/products', {
        ...product('Fractional sale'),
        sellingPriceMinor: '52900',
        openingStock: '10',
      }).expect(201)
    ).body;
    const input = {
      idempotencyKey: randomUUID(),
      items: [{ productId: p.id, quantity: '1.25' }],
      paymentMethod: 'CASH',
      amountReceived: '700',
    };
    const sale = (await write(owner, '/sales', input).expect(201)).body;
    expect(sale).toMatchObject({
      subtotalMinor: '66125',
      totalMinor: '66125',
      amountReceivedMinor: '70000',
      changeMinor: '3875',
    });
    expect(sale.items[0]).toMatchObject({
      quantity: '1.25',
      unitPriceMinor: '52900',
      lineTotalMinor: '66125',
    });
    expect(sale.payments[0].amountMinor).toBe('66125');
    const repeated = await write(owner, '/sales', {
      ...input,
      amountReceived: undefined,
      amountReceivedMinor: '70000',
    }).expect(201);
    expect(repeated.body.id).toBe(sale.id);
    const fresh = new PrismaClient({ datasourceUrl: url });
    try {
      const restarted = createApp({ db: fresh, webOrigin: origin, checkDatabase: async () => {} });
      const loaded = (
        await request(restarted)
          .get('/api/v1/sales/' + sale.id)
          .set('Cookie', owner.cookie)
          .expect(200)
      ).body;
      expect(loaded).toMatchObject({
        totalMinor: '66125',
        amountReceivedMinor: '70000',
        changeMinor: '3875',
      });
      expect((await fresh.sale.findUniqueOrThrow({ where: { id: sale.id } })).changeMinor).toBe(
        3875n,
      );
      expect(
        (
          await fresh.stockLevel.findFirstOrThrow({
            where: { productId: p.id, businessId: owner.businessId },
          })
        ).quantity.toString(),
      ).toBe('8.75');
    } finally {
      await fresh.$disconnect();
    }
  });
  it('rejects invalid payment precision, negative amounts and partial payments without writing sales', async () => {
    const before = await db.sale.count({ where: { businessId: owner.businessId } }),
      base = {
        idempotencyKey: randomUUID(),
        items: [{ productId: pennyId, quantity: '1' }],
        paymentMethod: 'CASH',
      };
    for (const amountReceived of ['-1', '0.001', '390.501', 'abc', 390])
      await write(owner, '/sales', {
        ...base,
        idempotencyKey: randomUUID(),
        amountReceived,
      }).expect(400);
    const excessive = await write(owner, '/sales', { ...base, amountReceived: '1.001' }).expect(
      400,
    );
    expect(excessive.body.issues[0].message).toContain('two decimal places');
    const partial = await write(owner, '/sales', { ...base, amountReceived: '0' }).expect(400);
    expect(partial.body.code).toBe('INSUFFICIENT_PAYMENT');
    await write(owner, '/sales', {
      ...base,
      amountReceived: '1',
      totalMinor: '0',
      taxMinor: '0',
    }).expect(400);
    expect(await db.sale.count({ where: { businessId: owner.businessId } })).toBe(before);
  });
  it.each([
    ['475000', undefined, '475000', '0', 201],
    ['475000', '5000', '500000', '25000', 201],
    ['475000', '4700', '', '', 400],
    ['39050', '400', '40000', '950', 201],
    ['39000', '390', '39000', '0', 201],
  ])(
    'checks fast cash checkout: price %s, amount %s',
    async (price, amount, received, change, status) => {
      const p = (
        await write(owner, '/products', {
          ...product('Fast checkout'),
          sellingPriceMinor: price,
          openingStock: '2',
        }).expect(201)
      ).body;
      const key = randomUUID();
      const response = await write(owner, '/sales', {
        idempotencyKey: key,
        items: [{ productId: p.id, quantity: '1' }],
        paymentMethod: 'CASH',
        ...(amount === undefined ? { exactPayment: true } : { amountReceived: amount }),
      }).expect(status);
      const stored = await db.sale.findUnique({
        where: { businessId_idempotencyKey: { businessId: owner.businessId, idempotencyKey: key } },
        include: { payments: true },
      });
      const stock = await db.stockLevel.findFirstOrThrow({ where: { productId: p.id } });
      if (status === 201) {
        expect(response.body).toMatchObject({
          totalMinor: price,
          amountReceivedMinor: received,
          changeMinor: change,
        });
        expect(stored!.amountReceivedMinor).toBe(BigInt(received));
        expect(stored!.payments).toHaveLength(1);
        expect(stored!.payments[0].amountMinor).toBe(BigInt(price));
        expect(stock.quantity.toString()).toBe('1');
        expect((await read(owner, '/sales/' + stored!.id).expect(200)).body.changeMinor).toBe(
          change,
        );
      } else {
        expect(response.body.code).toBe('INSUFFICIENT_PAYMENT');
        expect(stored).toBeNull();
        expect(stock.quantity.toString()).toBe('2');
      }
    },
  );
  it('uses current database prices, fractional rounding and discounts for exact cash', async () => {
    const p = (
      await write(owner, '/products', {
        ...product('Current price'),
        sellingPriceMinor: '100',
        openingStock: '2',
      }).expect(201)
    ).body;
    await write(owner, '/products/' + p.id, { sellingPriceMinor: '101' }, 'patch').expect(200);
    const sale = (
      await write(owner, '/sales', {
        idempotencyKey: randomUUID(),
        items: [{ productId: p.id, quantity: '0.5' }],
        paymentMethod: 'CASH',
        exactPayment: true,
        discount: { type: 'FIXED', amountMinor: '1' },
      }).expect(201)
    ).body;
    expect(sale).toMatchObject({
      subtotalMinor: '51',
      totalMinor: '50',
      amountReceivedMinor: '50',
      changeMinor: '0',
    });
  });
  it('deduplicates concurrent exact-cash requests, including a retry after a price change', async () => {
    const p = (
      await write(owner, '/products', {
        ...product('Double click'),
        sellingPriceMinor: '475000',
        openingStock: '2',
      }).expect(201)
    ).body;
    const input = {
      idempotencyKey: randomUUID(),
      items: [{ productId: p.id, quantity: '1' }],
      paymentMethod: 'CASH',
      exactPayment: true,
    };
    const responses = await Promise.all([
      write(owner, '/sales', input),
      write(owner, '/sales', input),
    ]);
    expect(responses.map((r) => r.status)).toEqual([201, 201]);
    expect(responses[0].body.id).toBe(responses[1].body.id);
    expect(
      await db.sale.count({
        where: { businessId: owner.businessId, idempotencyKey: input.idempotencyKey },
      }),
    ).toBe(1);
    expect(await db.payment.count({ where: { saleId: responses[0].body.id } })).toBe(1);
    expect(await db.stockMovement.count({ where: { productId: p.id, movementType: 'SALE' } })).toBe(
      1,
    );
    expect(
      (await db.stockLevel.findFirstOrThrow({ where: { productId: p.id } })).quantity.toString(),
    ).toBe('1');
    await write(owner, '/products/' + p.id, { sellingPriceMinor: '500000' }, 'patch').expect(200);
    expect((await write(owner, '/sales', input).expect(201)).body.amountReceivedMinor).toBe(
      '475000',
    );
  });
  it('rolls back sale, payment, and every stock movement when a later item has no stock', async () => {
    const ids = [];
    for (let i = 0; i < 2; i++)
      ids.push(
        (
          await write(owner, '/products', {
            ...product('Rollback ' + i),
            openingStock: '1',
          }).expect(201)
        ).body.id as string,
      );
    ids.sort();
    const input = {
      idempotencyKey: randomUUID(),
      items: ids.map((productId, i) => ({ productId, quantity: i === 0 ? '1' : '2' })),
      paymentMethod: 'CASH',
      exactPayment: true,
    };
    await write(owner, '/sales', input).expect(409);
    expect(
      await db.sale.count({
        where: { businessId: owner.businessId, idempotencyKey: input.idempotencyKey },
      }),
    ).toBe(0);
    expect(
      await db.stockMovement.count({ where: { productId: { in: ids }, movementType: 'SALE' } }),
    ).toBe(0);
    for (const productId of ids)
      expect(
        (await db.stockLevel.findFirstOrThrow({ where: { productId } })).quantity.toString(),
      ).toBe('1');
  });
  it.each(['BANK_TRANSFER', 'MOBILE_MONEY', 'CARD'])(
    'preserves verification for %s',
    async (paymentMethod) => {
      const p = (
        await write(owner, '/products', {
          ...product('External payment'),
          openingStock: '1',
        }).expect(201)
      ).body;
      const base = { items: [{ productId: p.id, quantity: '1' }], paymentMethod };
      const send = (extra: object) =>
        write(owner, '/sales', { ...base, idempotencyKey: randomUUID(), ...extra });
      await send({ exactPayment: true, manualConfirmation: true, paymentReference: 'REF' }).expect(
        400,
      );
      await send({ amountReceived: '1.50' }).expect(400);
      await send({ amountReceived: '1.50', manualConfirmation: true }).expect(400);
      await send({ amountReceived: '1.50', paymentReference: 'REF' }).expect(400);
      await send({ amountReceived: '2', manualConfirmation: true, paymentReference: 'REF' }).expect(
        400,
      );
      const sale = (
        await send({
          amountReceived: '1.50',
          manualConfirmation: true,
          paymentReference: 'REF',
        }).expect(201)
      ).body;
      expect(sale.payments[0].verification).toBe('MANUAL_RECORD');
    },
  );
});
