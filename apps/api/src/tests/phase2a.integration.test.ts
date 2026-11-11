import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import request from 'supertest';
import { PrismaClient } from '@prisma/client';
import { randomBytes, randomUUID } from 'node:crypto';
import { execFileSync } from 'node:child_process';
import { resolve } from 'node:path';
import { createApp } from '../app';
import { hashPassword, verifyPassword } from '../security/password';
import { assertLocalBootstrap, bootstrapOwner } from '../security/bootstrap';
import { tokenHash } from '../security/session';

const url = process.env.TEST_DATABASE_URL;
const suite = url ? describe : describe.skip;
const origin = 'http://localhost:5173';
const password = randomBytes(24).toString('hex');
const businessId = randomUUID(),
  otherBusinessId = randomUUID();
let db: PrismaClient, app: ReturnType<typeof createApp>;
let ownerId = '',
  productId = '',
  categoryId = '',
  supplierId = '';
type Auth = { cookie: string; csrf: string };
let owner: Auth, manager: Auth, cashier: Auth, other: Auth;
function configured(options = {}) {
  return createApp({
    db,
    webOrigin: origin,
    checkDatabase: async () => db.$queryRawUnsafe('SELECT 1'),
    ...options,
  });
}
async function login(email: string, business = businessId, target = app): Promise<Auth> {
  const res = await request(target)
    .post('/api/v1/auth/login')
    .set('Origin', origin)
    .send({ businessId: business, email, password })
    .expect(200);
  expect(JSON.stringify(res.body)).not.toContain('passwordHash');
  expect(JSON.stringify(res.body)).not.toContain('tokenHash');
  return {
    cookie: (res.headers['set-cookie'] as unknown as string[])[0].split(';')[0],
    csrf: res.body.csrfToken,
  };
}
const write = (method: 'post' | 'patch', path: string, auth: Auth) => {
  const target = request(app);
  const pending =
    method === 'post' ? target.post('/api/v1' + path) : target.patch('/api/v1' + path);
  return pending.set('Cookie', auth.cookie).set('Origin', origin).set('X-CSRF-Token', auth.csrf);
};
const productBody = (sku = 'RICE-' + randomUUID()) => ({
  name: 'Rice',
  sku,
  barcode: 'BC-' + randomUUID(),
  purchaseCostMinor: '9223372036854775000',
  sellingPriceMinor: '9223372036854775807',
  categoryId,
  unit: 'kg',
  lowStockThreshold: '2.125',
});
suite('Phase 2A authenticated PostgreSQL catalogue', () => {
  beforeAll(async () => {
    const target = new URL(url!);
    if (
      !/^\/stockflow_test(?:[a-z0-9_]*)$/.test(target.pathname) ||
      !['localhost', '127.0.0.1', '[::1]'].includes(target.hostname)
    )
      throw new Error('Dedicated loopback stockflow_test database required');
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
    await db.business.createMany({
      data: [
        { id: businessId, name: 'Auth test', isDemo: true },
        { id: otherBusinessId, name: 'Other auth test', isDemo: true },
      ],
    });
    const created = await bootstrapOwner(db, {
      businessId,
      businessName: 'Unused',
      name: 'Owner test',
      email: 'owner@example.test',
      password,
    });
    ownerId = created.userId;
    const hash = await hashPassword(password);
    await db.user.createMany({
      data: [
        {
          businessId,
          name: 'Manager',
          email: 'manager@example.test',
          role: 'MANAGER',
          passwordHash: hash,
        },
        {
          businessId,
          name: 'Cashier',
          email: 'cashier@example.test',
          role: 'CASHIER',
          passwordHash: hash,
        },
        {
          businessId,
          name: 'Inactive',
          email: 'inactive@example.test',
          role: 'OWNER',
          passwordHash: hash,
          isActive: false,
        },
        {
          businessId: otherBusinessId,
          name: 'Other owner',
          email: 'other@example.test',
          role: 'OWNER',
          passwordHash: hash,
        },
      ],
    });
    app = configured();
    owner = await login('owner@example.test');
    manager = await login('manager@example.test');
    cashier = await login('cashier@example.test');
    other = await login('other@example.test', otherBusinessId);
  }, 60000);
  afterAll(async () => {
    await db?.$disconnect();
  });
  it('uses unique scrypt salts and verifies passwords', async () => {
    const a = await hashPassword(password),
      b = await hashPassword(password);
    expect(a).not.toBe(b);
    expect(await verifyPassword(password, a)).toBe(true);
    expect(await verifyPassword('wrong', a)).toBe(false);
  });
  it('returns generic failures for wrong, absent and inactive accounts', async () => {
    const attempts = [
      { email: 'owner@example.test', password: 'wrong' },
      { email: 'missing@example.test', password },
      { email: 'inactive@example.test', password },
    ];
    for (const attempt of attempts) {
      const res = await request(app)
        .post('/api/v1/auth/login')
        .set('Origin', origin)
        .send({ businessId, ...attempt })
        .expect(401);
      expect(res.body.code).toBe('INVALID_CREDENTIALS');
    }
  });
  it('uses hashed opaque sessions with HttpOnly/SameSite and HTTPS Secure flags', async () => {
    const response = await request(app)
      .post('/api/v1/auth/login')
      .set('Origin', origin)
      .send({ businessId, email: 'owner@example.test', password })
      .expect(200);
    const cookie = String(response.headers['set-cookie'][0]);
    expect(cookie).toContain('HttpOnly');
    expect(cookie).toContain('SameSite=Strict');
    const raw = cookie.split(';')[0].split('=')[1];
    expect(await db.userSession.findUnique({ where: { tokenHash: raw } })).toBeNull();
    expect(
      await db.userSession.findUnique({ where: { tokenHash: tokenHash(raw) } }),
    ).not.toBeNull();
    const secureApp = configured({ webOrigin: 'https://localhost:5173' });
    const secure = await request(secureApp)
      .post('/api/v1/auth/login')
      .set('Origin', 'https://localhost:5173')
      .send({ businessId, email: 'owner@example.test', password })
      .expect(200);
    expect(String(secure.headers['set-cookie'][0])).toContain('Secure');
    const session = await request(app)
      .get('/api/v1/auth/session')
      .set('Cookie', owner.cookie)
      .expect(200);
    expect(session.body.branchAccess).toBe('MAIN_STORE');
  });
  it('rejects anonymous, expired and revoked sessions and revokes on logout', async () => {
    await request(app).get('/api/v1/products').expect(401);
    const expired = await login('owner@example.test');
    await db.userSession.update({
      where: { tokenHash: tokenHash(expired.cookie.split('=')[1]) },
      data: { expiresAt: new Date(Date.now() - 1000) },
    });
    await request(app).get('/api/v1/auth/session').set('Cookie', expired.cookie).expect(401);
    const revoked = await login('owner@example.test');
    await write('post', '/auth/logout', revoked).send({}).expect(204);
    await request(app).get('/api/v1/auth/session').set('Cookie', revoked.cookie).expect(401);
    expect(
      (
        await db.userSession.findUniqueOrThrow({
          where: { tokenHash: tokenHash(revoked.cookie.split('=')[1]) },
        })
      ).revokedAt,
    ).not.toBeNull();
  });
  it('rejects CSRF and foreign origins, including login CSRF', async () => {
    await request(app)
      .post('/api/v1/auth/login')
      .set('Origin', 'https://evil.invalid')
      .send({ businessId, email: 'owner@example.test', password })
      .expect(403);
    await request(app)
      .post('/api/v1/categories')
      .set('Cookie', owner.cookie)
      .set('Origin', origin)
      .send({ name: 'Unsafe' })
      .expect(403);
    await request(app)
      .post('/api/v1/categories')
      .set('Cookie', owner.cookie)
      .set('Origin', 'https://evil.invalid')
      .set('X-CSRF-Token', owner.csrf)
      .send({ name: 'Unsafe' })
      .expect(403);
    await request(app).post('/api/v1/auth/logout').set('Cookie', owner.cookie).send({}).expect(403);
  });
  it('rate-limits repeated failed logins', async () => {
    const limited = configured({ loginLimit: 2 });
    for (let i = 0; i < 2; i++)
      await request(limited)
        .post('/api/v1/auth/login')
        .set('Origin', origin)
        .send({ businessId, email: 'owner@example.test', password: 'wrong' })
        .expect(401);
    await request(limited)
      .post('/api/v1/auth/login')
      .set('Origin', origin)
      .send({ businessId, email: 'owner@example.test', password: 'wrong' })
      .expect(429);
  });
  it('bootstraps deliberately and refuses account replacement', async () => {
    const usersBefore = await db.user.count();
    expect(() =>
      execFileSync(
        process.execPath,
        [
          resolve('../../node_modules/tsx/dist/cli.mjs'),
          'scripts/bootstrap-owner.ts',
          '--confirm-local-owner',
        ],
        {
          env: { ...process.env, DATABASE_URL: url, ALLOW_OWNER_BOOTSTRAP: 'true' },
          stdio: 'pipe',
        },
      ),
    ).toThrow();
    expect(await db.user.count()).toBe(usersBefore);
    expect(() => assertLocalBootstrap({ DATABASE_URL: url }, false, false)).toThrow();
    expect(() =>
      assertLocalBootstrap(
        { DATABASE_URL: 'postgresql://remote.invalid/db', ALLOW_OWNER_BOOTSTRAP: 'true' },
        true,
        true,
      ),
    ).toThrow();
    expect(() =>
      assertLocalBootstrap({ DATABASE_URL: url, ALLOW_OWNER_BOOTSTRAP: 'true' }, true, true),
    ).not.toThrow();
    await expect(
      bootstrapOwner(db, {
        businessId,
        businessName: 'Overwrite',
        name: 'Bad',
        email: 'replacement@example.test',
        password,
      }),
    ).rejects.toThrow();
    expect((await db.user.findUniqueOrThrow({ where: { id: ownerId } })).email).toBe(
      'owner@example.test',
    );
    const fresh = await bootstrapOwner(db, {
      businessName: 'Bootstrap fixture (illustrative)',
      name: 'Fixture owner',
      email: randomUUID() + '@example.test',
      password,
    });
    // This newly created record belongs only to the guarded disposable test database.
    await db.business.update({ where: { id: fresh.businessId }, data: { isDemo: true } });
    expect(await db.branch.count({ where: { businessId: fresh.businessId, code: 'MAIN' } })).toBe(
      1,
    );
    expect((await db.user.findUniqueOrThrow({ where: { id: fresh.userId } })).role).toBe('OWNER');
  });
  it('creates and updates categories and suppliers with audit records', async () => {
    const category = await write('post', '/categories', owner).send({ name: 'Grains' }).expect(201);
    categoryId = category.body.id;
    await write('patch', '/categories/' + categoryId, manager)
      .send({ name: 'Rice and grains' })
      .expect(200);
    expect(
      (
        await request(app).get('/api/v1/categories').set('Cookie', cashier.cookie).expect(200)
      ).body.some((c: { id: string }) => c.id === categoryId),
    ).toBe(true);
    const supplier = await write('post', '/suppliers', manager)
      .send({ name: 'Supplier', phone: '+220 700 0000' })
      .expect(201);
    supplierId = supplier.body.id;
    await write('patch', '/suppliers/' + supplierId, owner)
      .send({ isActive: false })
      .expect(200);
    await write('patch', '/suppliers/' + supplierId, owner)
      .send({ name: 'Renamed supplier' })
      .expect(200);
    expect((await db.supplier.findUniqueOrThrow({ where: { id: supplierId } })).isActive).toBe(
      false,
    );
    await request(app).get('/api/v1/suppliers').set('Cookie', owner.cookie).expect(200);
    expect(await db.auditLog.count({ where: { businessId, entityId: supplierId } })).toBe(3);
  });
  it('creates and updates exact BIGINT product values without stock changes', async () => {
    const created = await write('post', '/products', owner).send(productBody()).expect(201);
    productId = created.body.id;
    expect(created.body.sellingPriceMinor).toBe('9223372036854775807');
    expect(created.body.lowStockThreshold).toBe('2.125');
    await write('patch', '/products/' + productId, manager)
      .send({ name: 'Updated rice', unit: 'bag' })
      .expect(200);
    expect(
      (await db.product.findUniqueOrThrow({ where: { id: productId } })).sellingPriceMinor,
    ).toBe(9223372036854775807n);
    expect(
      (await db.product.findUniqueOrThrow({ where: { id: productId } })).lowStockThreshold.toFixed(
        3,
      ),
    ).toBe('2.125');
    expect(await db.stockLevel.count({ where: { productId } })).toBe(0);
    expect(await db.stockMovement.count({ where: { productId } })).toBe(0);
    expect(await db.auditLog.count({ where: { businessId, entityId: productId } })).toBe(2);
  });
  it('rejects duplicate SKU/barcode and invalid money or stock fields', async () => {
    const existing = await db.product.findUniqueOrThrow({ where: { id: productId } });
    await write('post', '/products', owner)
      .send({ ...productBody(), sku: existing.sku })
      .expect(409);
    await write('post', '/products', owner)
      .send({ ...productBody(), barcode: existing.barcode })
      .expect(409);
    for (const value of ['-1', '1.5', '9223372036854775808', '0', 200])
      await write('post', '/products', owner)
        .send({ ...productBody(), sellingPriceMinor: value })
        .expect(400);
    await write('patch', '/products/' + productId, owner)
      .send({ quantity: '100' })
      .expect(400);
    await write('patch', '/products/' + productId, owner)
      .send({ businessId: otherBusinessId })
      .expect(400);
  });
  it('searches name, SKU, barcode and category with bounded pagination', async () => {
    const existing = await db.product.findUniqueOrThrow({ where: { id: productId } });
    for (const search of ['Updated rice', existing.sku, existing.barcode!]) {
      const response = await request(app)
        .get('/api/v1/products')
        .query({ search, categoryId, limit: 10 })
        .set('Cookie', owner.cookie)
        .expect(200);
      expect(response.body.data[0].id).toBe(productId);
    }
    await request(app).get('/api/v1/products?limit=1.5').set('Cookie', owner.cookie).expect(400);
  });
  it('restricts cashiers, hides costs and isolates all tenants', async () => {
    for (const path of ['/products', '/categories', '/suppliers'])
      await write('post', path, cashier).send({}).expect(403);
    await request(app).get('/api/v1/suppliers').set('Cookie', cashier.cookie).expect(403);
    const safe = await request(app)
      .get('/api/v1/products/' + productId)
      .set('Cookie', cashier.cookie)
      .expect(200);
    expect(safe.body.purchaseCostMinor).toBeUndefined();
    await request(app)
      .get('/api/v1/products/' + productId)
      .set('Cookie', other.cookie)
      .expect(404);
    await write('patch', '/products/' + productId, other)
      .send({ name: 'Foreign' })
      .expect(404);
    await write('patch', '/categories/' + categoryId, other)
      .send({ name: 'Foreign' })
      .expect(404);
    await write('patch', '/suppliers/' + supplierId, other)
      .send({ isActive: true })
      .expect(404);
    await write('post', '/products', other).send(productBody()).expect(404);
    const list = await request(app)
      .get('/api/v1/products')
      .set('Cookie', other.cookie)
      .set('X-Business-Id', businessId)
      .expect(200);
    expect(list.body.total).toBe(0);
  });
  it('persists across application/client restart and deactivates without deletion', async () => {
    const restartedDb = new PrismaClient({ datasourceUrl: url });
    try {
      const restarted = createApp({
        db: restartedDb,
        webOrigin: origin,
        checkDatabase: async () => {},
      });
      const response = await request(restarted)
        .get('/api/v1/products/' + productId)
        .set('Cookie', owner.cookie)
        .expect(200);
      expect(response.body.name).toBe('Updated rice');
    } finally {
      await restartedDb.$disconnect();
    }
    await write('patch', '/products/' + productId, manager)
      .send({ isActive: false })
      .expect(200);
    await write('patch', '/products/' + productId, manager)
      .send({ name: 'Inactive rice' })
      .expect(200);
    const preserved = await db.product.findUniqueOrThrow({ where: { id: productId } });
    expect(preserved.isActive).toBe(false);
    expect(preserved.unit).toBe('bag');
    expect(preserved.lowStockThreshold.toFixed(3)).toBe('2.125');
    await request(app)
      .get('/api/v1/products/' + productId)
      .set('Cookie', cashier.cookie)
      .expect(404);
    const hidden = await request(app)
      .get('/api/v1/products')
      .set('Cookie', cashier.cookie)
      .expect(200);
    expect(hidden.body.total).toBe(0);
    await request(app)
      .delete('/api/v1/products/' + productId)
      .set('Cookie', owner.cookie)
      .expect(403);
    for (const path of ['/sales', '/inventory/receipts'])
      await write('post', path, owner).send({}).expect(400);
    await write('post', '/reports/summary', owner).send({}).expect(501);
  });
});
