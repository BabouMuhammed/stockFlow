import type { WebOrigins } from '../config/origins';
import { type Prisma, type PrismaClient } from '@prisma/client';
import { z } from 'zod';
import { rateLimit } from 'express-rate-limit';
import { identity } from '../security/session';
import { hashPassword, verifyPassword } from '../security/password';
import { ApiError, route } from '../utils/http';
import { minorUnits, decimalQuantity, text, uuid } from '../utils/validation';
import { audit, lockKey, operators, ownerOnly, protectedRouter, serial } from './operations';
import { dateWhere, paymentMethod, saleQuery } from './sales';

const safeUser = {
  id: true,
  name: true,
  email: true,
  role: true,
  isActive: true,
  createdAt: true,
} as const;
const email = z.string().trim().toLowerCase().email().max(254);
const optionalText = (max: number) => z.string().trim().max(max).nullable().optional();
const customerInput = z
  .object({
    name: text(120),
    phone: optionalText(40),
    email: email.nullable().optional(),
    address: optionalText(240),
    notes: z.string().trim().max(2000).default(''),
  })
  .strict();
const expenseInput = z
  .object({
    title: text(120),
    category: text(80),
    amountMinor: minorUnits.refine((v) => v > 0n, 'Amount must be positive'),
    date: z.iso.date(),
    description: z.string().trim().max(2000).default(''),
    paymentMethod,
  })
  .strict();
export function managementRouter(db: PrismaClient, origin: WebOrigins) {
  const router = protectedRouter(db, origin);
  router.get(
    '/staff',
    ownerOnly,
    route(async (_req, res) => {
      res.json(
        await db.user.findMany({
          where: { businessId: identity(res).user.businessId },
          select: safeUser,
          orderBy: { name: 'asc' },
        }),
      );
    }),
  );
  const accessLimit = rateLimit({
    windowMs: 15 * 60000,
    limit: 20,
    standardHeaders: 'draft-8',
    legacyHeaders: false,
  });
  router.post(
    '/staff',
    ownerOnly,
    accessLimit,
    route(async (req, res) => {
      const input = z
        .object({
          name: text(120),
          email,
          password: z.string().min(12).max(128),
          role: z.enum(['MANAGER', 'CASHIER']),
        })
        .strict()
        .parse(req.body);
      const auth = identity(res),
        businessId = auth.user.businessId,
        passwordHash = await hashPassword(input.password);
      const user = await db.$transaction(async (tx) => {
        await tx.$executeRaw`SELECT pg_advisory_xact_lock(hashtextextended(${input.email}, 0))`;
        if (await tx.user.findFirst({ where: { email: input.email } }))
          throw new ApiError(409, 'EMAIL_EXISTS', 'Email already has an account');
        const created = await tx.user.create({
          data: {
            businessId,
            name: input.name,
            email: input.email,
            role: input.role,
            passwordHash,
          },
          select: safeUser,
        });
        await audit(tx, auth, 'STAFF_CREATE', 'User', created.id);
        return created;
      });
      res.status(201).json(user);
    }),
  );
  router.patch(
    '/staff/:id',
    ownerOnly,
    accessLimit,
    route(async (req, res) => {
      const id = uuid.parse(req.params.id),
        input = z
          .object({
            name: text(120).optional(),
            role: z.enum(['MANAGER', 'CASHIER']).optional(),
            isActive: z.boolean().optional(),
            password: z.string().min(12).max(128).optional(),
          })
          .strict()
          .parse(req.body);
      const auth = identity(res),
        businessId = auth.user.businessId;
      if (id === auth.user.id)
        throw new ApiError(403, 'FORBIDDEN', 'Use account settings to change your own access');
      const hash = input.password ? await hashPassword(input.password) : undefined;
      const user = await serial(db, async (tx) => {
        const target = await tx.user.findFirst({ where: { id, businessId } });
        if (!target) throw new ApiError(404, 'NOT_FOUND', 'Employee not found');
        if (target.role === 'OWNER')
          throw new ApiError(
            403,
            'FORBIDDEN',
            'Owner accounts cannot be changed through employee administration',
          );
        const fields = {
          ...(input.name !== undefined ? { name: input.name } : {}),
          ...(input.role !== undefined ? { role: input.role } : {}),
          ...(input.isActive !== undefined ? { isActive: input.isActive } : {}),
        };
        const changed = await tx.user.update({
          where: { id },
          data: { ...fields, ...(hash ? { passwordHash: hash } : {}) },
          select: safeUser,
        });
        await tx.userSession.updateMany({
          where: { businessId, userId: id, revokedAt: null },
          data: { revokedAt: new Date() },
        });
        await audit(tx, auth, 'STAFF_UPDATE', 'User', id, {
          fields: Object.keys(fields),
          accessReset: !!hash,
        });
        return changed;
      });
      res.json(user);
    }),
  );
  router.get(
    '/staff/activity',
    ownerOnly,
    route(async (req, res) => {
      const input = saleQuery.pick({ page: true, limit: true }).parse(req.query),
        where = { businessId: identity(res).user.businessId };
      const [data, total] = await db.$transaction([
        db.auditLog.findMany({
          where,
          include: { user: { select: { name: true } } },
          orderBy: [{ createdAt: 'desc' }, { id: 'desc' }],
          skip: (input.page - 1) * input.limit,
          take: input.limit,
        }),
        db.auditLog.count({ where }),
      ]);
      res.json({ data, total, ...input });
    }),
  );
  router.get(
    '/settings',
    ownerOnly,
    route(async (_req, res) => res.json(identity(res).business)),
  );
  router.patch(
    '/settings',
    ownerOnly,
    route(async (req, res) => {
      const input = z
        .object({
          name: text(120).optional(),
          phone: optionalText(40),
          email: email.nullable().optional(),
          address: optionalText(240),
          receiptHeader: z.string().trim().max(240).optional(),
          receiptFooter: z.string().trim().max(240).optional(),
          defaultLowStockThreshold: decimalQuantity.optional(),
        })
        .strict()
        .parse(req.body);
      const auth = identity(res);
      const business = await db.$transaction(async (tx) => {
        const updated = await tx.business.update({
          where: { id: auth.user.businessId },
          data: input,
        });
        await audit(tx, auth, 'SETTINGS_UPDATE', 'Business', updated.id, {
          fields: Object.keys(input),
        });
        return updated;
      });
      res.json(business);
    }),
  );
  router.patch(
    '/account',
    route(async (req, res) => {
      const input = z
          .object({ name: text(120) })
          .strict()
          .parse(req.body),
        auth = identity(res);
      await db.$transaction(async (tx) => {
        await tx.user.update({ where: { id: auth.user.id }, data: input });
        await audit(tx, auth, 'ACCOUNT_UPDATE', 'User', auth.user.id);
      });
      res.status(204).end();
    }),
  );
  router.post(
    '/account/password',
    accessLimit,
    route(async (req, res) => {
      const input = z
          .object({
            currentPassword: z.string().min(1).max(128),
            password: z.string().min(12).max(128),
          })
          .strict()
          .parse(req.body),
        auth = identity(res);
      if (!(await verifyPassword(input.currentPassword, auth.user.passwordHash)))
        throw new ApiError(400, 'INVALID_PASSWORD', 'Current password is incorrect');
      const passwordHash = await hashPassword(input.password);
      await db.$transaction(async (tx) => {
        const changed = await tx.user.updateMany({
          where: { id: auth.user.id, passwordHash: auth.user.passwordHash },
          data: { passwordHash },
        });
        if (!changed.count)
          throw new ApiError(409, 'ACCESS_CHANGED', 'Your access changed; sign in again');
        await tx.userSession.updateMany({
          where: { businessId: auth.user.businessId, userId: auth.user.id },
          data: { revokedAt: new Date() },
        });
        await audit(tx, auth, 'PASSWORD_CHANGE', 'User', auth.user.id);
      });
      res.status(204).end();
    }),
  );
  router.get(
    '/account/sessions',
    route(async (_req, res) => {
      const auth = identity(res);
      res.json(
        await db.userSession.findMany({
          where: {
            businessId: auth.user.businessId,
            userId: auth.user.id,
            revokedAt: null,
            expiresAt: { gt: new Date() },
          },
          select: { id: true, createdAt: true, expiresAt: true },
          orderBy: { createdAt: 'desc' },
        }),
      );
    }),
  );
  router.post(
    '/account/sessions/revoke',
    route(async (_req, res) => {
      const auth = identity(res);
      await db.userSession.updateMany({
        where: {
          businessId: auth.user.businessId,
          userId: auth.user.id,
          id: { not: auth.session.id },
          revokedAt: null,
        },
        data: { revokedAt: new Date() },
      });
      res.status(204).end();
    }),
  );
  router.get(
    '/customers',
    route(async (req, res) => {
      const input = saleQuery.pick({ page: true, limit: true, search: true }).parse(req.query),
        businessId = identity(res).user.businessId;
      const where: Prisma.CustomerWhereInput = {
        businessId,
        OR: [
          { name: { contains: input.search, mode: 'insensitive' } },
          { phone: { contains: input.search } },
        ],
      };
      const [data, total] = await db.$transaction([
        db.customer.findMany({
          where,
          orderBy: [{ name: 'asc' }, { id: 'asc' }],
          skip: (input.page - 1) * input.limit,
          take: input.limit,
        }),
        db.customer.count({ where }),
      ]);
      res.json({ data, total, page: input.page, limit: input.limit });
    }),
  );
  router.post(
    '/customers',
    route(async (req, res) => {
      const input = customerInput.parse(req.body),
        auth = identity(res);
      const customer = await db.$transaction(async (tx) => {
        const c = await tx.customer.create({
          data: { ...input, businessId: auth.user.businessId },
        });
        await audit(tx, auth, 'CUSTOMER_CREATE', 'Customer', c.id);
        return c;
      });
      res.status(201).json(customer);
    }),
  );
  router.patch(
    '/customers/:id',
    operators,
    route(async (req, res) => {
      const id = uuid.parse(req.params.id),
        input = customerInput
          .partial()
          .extend({ notes: z.string().trim().max(2000).optional() })
          .parse(req.body),
        auth = identity(res);
      res.json(
        await db.$transaction(async (tx) => {
          const changed = await tx.customer.updateMany({
            where: { id, businessId: auth.user.businessId },
            data: input,
          });
          if (!changed.count) throw new ApiError(404, 'NOT_FOUND', 'Customer not found');
          await audit(tx, auth, 'CUSTOMER_UPDATE', 'Customer', id);
          return tx.customer.findUniqueOrThrow({ where: { id } });
        }),
      );
    }),
  );
  router.get(
    '/customers/:id/sales',
    route(async (req, res) => {
      const id = uuid.parse(req.params.id),
        auth = identity(res),
        input = saleQuery.pick({ page: true, limit: true }).parse(req.query);
      if (!(await db.customer.findFirst({ where: { id, businessId: auth.user.businessId } })))
        throw new ApiError(404, 'NOT_FOUND', 'Customer not found');
      const where = {
        businessId: auth.user.businessId,
        customerId: id,
        ...(auth.user.role === 'CASHIER' ? { cashierId: auth.user.id } : {}),
      };
      const [data, total] = await db.$transaction([
        db.sale.findMany({
          where,
          select: { id: true, receiptNumber: true, totalMinor: true, createdAt: true },
          orderBy: [{ createdAt: 'desc' }, { id: 'desc' }],
          skip: (input.page - 1) * input.limit,
          take: input.limit,
        }),
        db.sale.count({ where }),
      ]);
      res.json({ data, total, ...input });
    }),
  );
  router.get(
    '/expenses',
    operators,
    route(async (req, res) => {
      const input = saleQuery
          .pick({ page: true, limit: true, from: true, to: true, search: true })
          .extend({ category: z.string().max(80).optional() })
          .parse(req.query),
        businessId = identity(res).user.businessId;
      const where = {
        businessId,
        title: { contains: input.search, mode: 'insensitive' as const },
        date: dateWhere(input.from, input.to),
        ...(input.category ? { category: input.category } : {}),
      };
      const [data, total, aggregate] = await db.$transaction([
        db.expense.findMany({
          where,
          orderBy: [{ date: 'desc' }, { id: 'desc' }],
          skip: (input.page - 1) * input.limit,
          take: input.limit,
        }),
        db.expense.count({ where }),
        db.expense.aggregate({ where, _sum: { amountMinor: true } }),
      ]);
      res.json({
        data,
        total,
        page: input.page,
        limit: input.limit,
        totalMinor: aggregate._sum.amountMinor ?? 0n,
      });
    }),
  );
  router.post(
    '/expenses',
    operators,
    route(async (req, res) => {
      const input = expenseInput.parse(req.body),
        auth = identity(res);
      validateOperatingCategory(input.category);
      const expense = await db.$transaction(async (tx) => {
        const e = await tx.expense.create({
          data: {
            ...input,
            date: new Date(input.date + 'T00:00:00Z'),
            businessId: auth.user.businessId,
            actorId: auth.user.id,
          },
        });
        await audit(tx, auth, 'EXPENSE_CREATE', 'Expense', e.id);
        return e;
      });
      res.status(201).json(expense);
    }),
  );
  router.patch(
    '/expenses/:id',
    operators,
    route(async (req, res) => {
      const id = uuid.parse(req.params.id),
        input = expenseInput.parse(req.body),
        auth = identity(res);
      res.json(
        await serial(db, async (tx) => {
          await lockKey(tx, auth.user.businessId, id);
          const previous = await tx.expense.findFirst({
            where: { id, businessId: auth.user.businessId },
          });
          if (!previous) throw new ApiError(404, 'NOT_FOUND', 'Expense not found');
          if (input.category !== previous.category) validateOperatingCategory(input.category);
          const changed = await tx.expense.update({
            where: { id },
            data: { ...input, date: new Date(input.date + 'T00:00:00Z') },
          });
          await audit(tx, auth, 'EXPENSE_UPDATE', 'Expense', id, {
            before: {
              title: previous.title,
              category: previous.category,
              amountMinor: previous.amountMinor.toString(),
              date: previous.date.toISOString(),
              description: previous.description,
              paymentMethod: previous.paymentMethod,
            },
            after: { ...input, amountMinor: input.amountMinor.toString() },
          });
          return changed;
        }),
      );
    }),
  );
  return router;
}

export function validateOperatingCategory(category: string) {
  if (
    /^(inventory|stock|supplier)\s*(purchases?|payments?|settlements?)$|^(purchases?|cost of goods sold|cogs)$/i.test(
      category.trim(),
    )
  )
    throw new ApiError(
      400,
      'INVENTORY_NOT_OPERATING_EXPENSE',
      'Use Stock receipts and supplier payments for inventory purchases, not operating expenses',
    );
}
