import type { WebOrigins } from '../config/origins';
import { Router, type RequestHandler } from 'express';
import { Prisma, type PrismaClient, type Product, type Role } from '@prisma/client';
import { ApiError, route } from '../utils/http';
import { can } from '../middleware/authorization';
import { identity, requireSession, verifyCsrf } from '../security/session';
import {
  categoryInput,
  categoryUpdate,
  productCreateInput,
  productQuery,
  productUpdate,
  supplierInput,
  supplierUpdate,
  uuid,
} from '../utils/validation';
import { mainBranch, moveStock } from './operations';
import { randomUUID } from 'node:crypto';
import { allocateProductSku, lockProductSkus } from './product-skus';

export function productDto(
  product: Product & {
    category?: { id: string; name: string } | null;
    stockLevels?: { quantity: Prisma.Decimal }[];
  },
  role: Role,
) {
  // Cashiers never receive purchase costs, even through search or direct ID lookup.
  const { purchaseCostMinor, stockLevels, ...fields } = product;
  const safe = { ...fields, quantity: stockLevels?.[0]?.quantity ?? new Prisma.Decimal(0) };
  return role === 'CASHIER' ? safe : { ...safe, purchaseCostMinor };
}
export function catalogueRouter(db: PrismaClient, webOrigin: WebOrigins) {
  const router = Router();
  router.use(requireSession(db));
  router.use((_req, res, next) => {
    res.set('Cache-Control', 'no-store');
    next();
  });
  const write: RequestHandler = (req, res, next) => {
    try {
      verifyCsrf(req, res, webOrigin);
      if (!can(identity(res).user.role, 'catalogue:write'))
        throw new ApiError(
          403,
          'FORBIDDEN',
          'Catalogue administration requires an owner or manager',
        );
      next();
    } catch (error) {
      next(error);
    }
  };
  const adminRead: RequestHandler = (_req, res, next) => {
    if (identity(res).user.role === 'CASHIER')
      next(new ApiError(403, 'FORBIDDEN', 'Supplier information requires an owner or manager'));
    else next();
  };
  const audit = (
    tx: Prisma.TransactionClient,
    res: Parameters<RequestHandler>[1],
    action: string,
    entityType: string,
    entityId: string,
    fields: string[] = [],
  ) =>
    tx.auditLog.create({
      data: {
        businessId: identity(res).user.businessId,
        userId: identity(res).user.id,
        action,
        entityType,
        entityId,
        metadata: { fields },
      },
    });

  router.get(
    '/business',
    route(async (_req, res) => {
      const { id, name, currency, isDemo } = identity(res).business;
      res.json({ id, name, currency, isDemo });
    }),
  );
  router.get(
    '/products',
    route(async (req, res) => {
      const input = productQuery.parse(req.query);
      const auth = identity(res),
        businessId = auth.user.businessId;
      const where: Prisma.ProductWhereInput = {
        businessId,
        ...(auth.user.role === 'CASHIER'
          ? { isActive: true }
          : input.active
            ? { isActive: input.active === 'true' }
            : {}),
        ...(input.categoryId ? { categoryId: input.categoryId } : {}),
        ...(input.search
          ? {
              OR: [
                { name: { contains: input.search, mode: 'insensitive' } },
                { sku: { contains: input.search, mode: 'insensitive' } },
                { barcode: { contains: input.search, mode: 'insensitive' } },
              ],
            }
          : {}),
      };
      const [products, total] = await db.$transaction([
        db.product.findMany({
          where,
          include: {
            category: { select: { id: true, name: true } },
            stockLevels: { where: { branch: { code: 'MAIN' } }, select: { quantity: true } },
          },
          orderBy: [
            input.sort === 'price'
              ? { sellingPriceMinor: 'asc' }
              : input.sort === 'newest'
                ? { createdAt: 'desc' }
                : { name: 'asc' },
            { id: 'asc' },
          ],
          skip: (input.page - 1) * input.limit,
          take: input.limit,
        }),
        db.product.count({ where }),
      ]);
      res.json({
        data: products.map((p) => productDto(p, auth.user.role)),
        page: input.page,
        limit: input.limit,
        total,
      });
    }),
  );
  router.get(
    '/products/:id',
    route(async (req, res) => {
      const auth = identity(res);
      const product = await db.product.findFirst({
        where: {
          id: uuid.parse(req.params.id),
          businessId: auth.user.businessId,
          ...(auth.user.role === 'CASHIER' ? { isActive: true } : {}),
        },
        include: {
          category: { select: { id: true, name: true } },
          stockLevels: { where: { branch: { code: 'MAIN' } }, select: { quantity: true } },
        },
      });
      if (!product) throw new ApiError(404, 'NOT_FOUND', 'Product not found');
      res.json(productDto(product, auth.user.role));
    }),
  );
  router.post(
    '/products',
    write,
    route(async (req, res) => {
      const { openingStock, ...input } = productCreateInput.parse(req.body),
        businessId = identity(res).user.businessId;
      const product = await db.$transaction(async (tx) => {
        const sku = await allocateProductSku(tx, businessId, input.sku);
        if (
          input.supplierId &&
          !(await tx.supplier.findFirst({
            where: { id: input.supplierId, businessId, isActive: true },
          }))
        )
          throw new ApiError(404, 'NOT_FOUND', 'Supplier not found');
        if (
          input.categoryId &&
          !(await tx.category.findFirst({
            where: { id: input.categoryId, businessId, isActive: true },
          }))
        )
          throw new ApiError(404, 'NOT_FOUND', 'Category not found');
        const created = await tx.product.create({
          data: {
            ...input,
            sku,
            lowStockThreshold:
              input.lowStockThreshold ?? identity(res).business.defaultLowStockThreshold,
            barcode: input.barcode || null,
            businessId,
          },
          include: { category: { select: { id: true, name: true } } },
        });
        if (openingStock && new Prisma.Decimal(openingStock).gt(0)) {
          const branchId = await mainBranch(tx, businessId);
          await moveStock(
            tx,
            identity(res),
            branchId,
            created.id,
            new Prisma.Decimal(openingStock),
            'ADJUSTMENT',
            'OPENING',
            randomUUID(),
            'Opening stock at product registration',
          );
        }
        await audit(tx, res, 'PRODUCT_CREATE', 'Product', created.id, Object.keys(input));
        return tx.product.findFirstOrThrow({
          where: { id: created.id, businessId },
          include: {
            category: { select: { id: true, name: true } },
            stockLevels: { where: { branch: { code: 'MAIN' } }, select: { quantity: true } },
          },
        });
      });
      res.status(201).json(productDto(product, identity(res).user.role));
    }),
  );
  router.patch(
    '/products/:id',
    write,
    route(async (req, res) => {
      const id = uuid.parse(req.params.id),
        input = productUpdate.parse(req.body),
        businessId = identity(res).user.businessId;
      if (!Object.keys(input).length)
        throw new ApiError(400, 'VALIDATION_ERROR', 'Provide at least one product field');
      const product = await db.$transaction(async (tx) => {
        if (input.sku !== undefined) {
          await lockProductSkus(tx, businessId);
          if (
            await tx.product.findFirst({
              where: { businessId, sku: input.sku, id: { not: id } },
              select: { id: true },
            })
          )
            throw new ApiError(409, 'DUPLICATE_SKU', 'This SKU already exists in your business');
        }
        if (
          input.supplierId &&
          !(await tx.supplier.findFirst({
            where: { id: input.supplierId, businessId, isActive: true },
          }))
        )
          throw new ApiError(404, 'NOT_FOUND', 'Supplier not found');
        if (
          input.categoryId &&
          !(await tx.category.findFirst({ where: { id: input.categoryId, businessId } }))
        )
          throw new ApiError(404, 'NOT_FOUND', 'Category not found');
        const updated = await tx.product.updateMany({
          where: { id, businessId },
          data: { ...input, ...('barcode' in input ? { barcode: input.barcode || null } : {}) },
        });
        if (!updated.count) throw new ApiError(404, 'NOT_FOUND', 'Product not found');
        await audit(tx, res, 'PRODUCT_UPDATE', 'Product', id, Object.keys(input));
        return tx.product.findFirstOrThrow({
          where: { id, businessId },
          include: {
            category: { select: { id: true, name: true } },
            stockLevels: { where: { branch: { code: 'MAIN' } }, select: { quantity: true } },
          },
        });
      });
      res.json(productDto(product, identity(res).user.role));
    }),
  );
  router.get(
    '/categories',
    route(async (_req, res) => {
      res.json(
        await db.category.findMany({
          where: {
            businessId: identity(res).user.businessId,
            ...(identity(res).user.role === 'CASHIER' ? { isActive: true } : {}),
          },
          orderBy: { name: 'asc' },
        }),
      );
    }),
  );
  router.post(
    '/categories',
    write,
    route(async (req, res) => {
      const input = categoryInput.parse(req.body),
        businessId = identity(res).user.businessId;
      res.status(201).json(
        await db.$transaction(async (tx) => {
          const record = await tx.category.create({ data: { ...input, businessId } });
          await audit(tx, res, 'CATEGORY_CREATE', 'Category', record.id, Object.keys(input));
          return record;
        }),
      );
    }),
  );
  router.patch(
    '/categories/:id',
    write,
    route(async (req, res) => {
      const id = uuid.parse(req.params.id),
        input = categoryUpdate.parse(req.body),
        businessId = identity(res).user.businessId;
      res.json(
        await db.$transaction(async (tx) => {
          const changed = await tx.category.updateMany({ where: { id, businessId }, data: input });
          if (!changed.count) throw new ApiError(404, 'NOT_FOUND', 'Category not found');
          await audit(tx, res, 'CATEGORY_UPDATE', 'Category', id, Object.keys(input));
          return tx.category.findFirstOrThrow({ where: { id, businessId } });
        }),
      );
    }),
  );
  router.get(
    '/suppliers',
    adminRead,
    route(async (_req, res) => {
      res.json(
        await db.supplier.findMany({
          where: { businessId: identity(res).user.businessId },
          orderBy: { name: 'asc' },
        }),
      );
    }),
  );
  router.post(
    '/suppliers',
    write,
    route(async (req, res) => {
      const input = supplierInput.parse(req.body),
        businessId = identity(res).user.businessId;
      res.status(201).json(
        await db.$transaction(async (tx) => {
          const record = await tx.supplier.create({ data: { ...input, businessId } });
          await audit(tx, res, 'SUPPLIER_CREATE', 'Supplier', record.id, Object.keys(input));
          return record;
        }),
      );
    }),
  );
  router.patch(
    '/suppliers/:id',
    write,
    route(async (req, res) => {
      const id = uuid.parse(req.params.id),
        input = supplierUpdate.parse(req.body),
        businessId = identity(res).user.businessId;
      if (!Object.keys(input).length)
        throw new ApiError(400, 'VALIDATION_ERROR', 'Provide at least one supplier field');
      res.json(
        await db.$transaction(async (tx) => {
          const changed = await tx.supplier.updateMany({ where: { id, businessId }, data: input });
          if (!changed.count) throw new ApiError(404, 'NOT_FOUND', 'Supplier not found');
          await audit(tx, res, 'SUPPLIER_UPDATE', 'Supplier', id, Object.keys(input));
          return tx.supplier.findFirstOrThrow({ where: { id, businessId } });
        }),
      );
    }),
  );
  return router;
}
