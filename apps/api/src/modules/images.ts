import type { WebOrigins } from '../config/origins';
import express from 'express';
import { randomUUID } from 'node:crypto';
import { mkdir, writeFile } from 'node:fs/promises';
import { resolve } from 'node:path';
import type { PrismaClient } from '@prisma/client';
import { identity } from '../security/session';
import { ApiError, route } from '../utils/http';
import { uuid } from '../utils/validation';
import { audit, operators, protectedRouter } from './operations';
import { checkImageStorage, imageStorageFromEnv, type ImageStorage } from '../config/storage';

export function imageType(buffer: Buffer): 'png' | 'jpg' | 'webp' | null {
  if (buffer.length < 16) return null;
  if (buffer.subarray(0, 8).equals(Buffer.from([137, 80, 78, 71, 13, 10, 26, 10]))) return 'png';
  if (
    buffer[0] === 255 &&
    buffer[1] === 216 &&
    buffer[2] === 255 &&
    buffer[buffer.length - 2] === 255 &&
    buffer[buffer.length - 1] === 217
  )
    return 'jpg';
  if (buffer.toString('ascii', 0, 4) === 'RIFF' && buffer.toString('ascii', 8, 12) === 'WEBP')
    return 'webp';
  return null;
}
export function imagesRouter(
  db: PrismaClient,
  origin: WebOrigins,
  storage: ImageStorage = imageStorageFromEnv({ IMAGE_STORAGE: 'local' }),
) {
  const router = protectedRouter(db, origin);
  router.use('/:id/image', (_req, _res, next) => {
    if (storage.mode === 'disabled')
      return next(
        new ApiError(
          503,
          'IMAGE_STORAGE_DISABLED',
          'Product images are disabled until durable storage is configured',
        ),
      );
    void checkImageStorage(storage).then(() => next(), next);
  });
  const root = storage.mode === 'disabled' ? '' : storage.directory;
  router.post(
    '/:id/image',
    operators,
    express.raw({ type: ['image/png', 'image/jpeg', 'image/webp'], limit: '2mb' }),
    route(async (req, res) => {
      const id = uuid.parse(req.params.id),
        auth = identity(res),
        businessId = auth.user.businessId;
      if (!Buffer.isBuffer(req.body))
        throw new ApiError(400, 'INVALID_IMAGE', 'Upload a PNG, JPEG or WebP image');
      const type = imageType(req.body);
      if (
        !type ||
        req.get('Content-Type') !==
          { png: 'image/png', jpg: 'image/jpeg', webp: 'image/webp' }[type]
      )
        throw new ApiError(400, 'INVALID_IMAGE', 'Image contents do not match the file type');
      if (!(await db.product.findFirst({ where: { id, businessId } })))
        throw new ApiError(404, 'NOT_FOUND', 'Product not found');
      const imageKey = randomUUID() + '.' + type,
        directory = resolve(root, businessId);
      await mkdir(directory, { recursive: true });
      await writeFile(resolve(directory, imageKey), req.body, { flag: 'wx' });
      await db.$transaction(async (tx) => {
        await tx.product.update({ where: { id }, data: { imageKey } });
        await audit(tx, auth, 'PRODUCT_IMAGE_UPLOAD', 'Product', id);
      });
      res.status(201).json({ imageKey });
    }),
  );
  router.get(
    '/:id/image',
    route(async (req, res) => {
      const id = uuid.parse(req.params.id),
        auth = identity(res),
        product = await db.product.findFirst({
          where: {
            id,
            businessId: auth.user.businessId,
            ...(auth.user.role === 'CASHIER' ? { isActive: true } : {}),
          },
          select: { imageKey: true },
        });
      if (!product?.imageKey || !/^[-a-f0-9]{36}\.(png|jpg|webp)$/.test(product.imageKey))
        throw new ApiError(404, 'NOT_FOUND', 'Image not found');
      res.set('Content-Security-Policy', "default-src 'none'");
      await new Promise<void>((done, reject) =>
        res.sendFile(resolve(root, auth.user.businessId, product.imageKey!), (error) =>
          error ? reject(new ApiError(404, 'NOT_FOUND', 'Image file unavailable')) : done(),
        ),
      );
    }),
  );
  return router;
}
