import express, { type ErrorRequestHandler } from 'express';
import cors from 'cors';
import { Prisma, type PrismaClient } from '@prisma/client';
import { z } from 'zod';
import { authRouter, type AuthOptions } from './modules/auth';
import { catalogueRouter } from './modules/catalogue';
import { inventoryRouter } from './modules/inventory';
import { salesRouter } from './modules/sales';
import { managementRouter } from './modules/management';
import { reportsRouter } from './modules/reports';
import { imagesRouter } from './modules/images';
import { ApiError, jsonReplacer } from './utils/http';
import { allowedWebOrigins } from './config/origins';
import { configureProxy } from './config/proxy';
import type { ImageStorage } from './config/storage';
export function createApp(
  options: AuthOptions & {
    checkDatabase: () => Promise<unknown>;
    db?: PrismaClient;
    trustedProxyCidrs?: readonly string[];
    imageStorage?: ImageStorage;
    bootstrap?: boolean;
  },
) {
  const app = express();
  configureProxy(app, options.bootstrap ? [] : options.trustedProxyCidrs);
  const origins = allowedWebOrigins(options.webOrigin, options.webOrigins);
  app.disable('x-powered-by');
  app.set('json replacer', jsonReplacer);
  if (!options.bootstrap) app.use(cors({ origin: origins, credentials: true }));
  app.use((_req, res, next) => {
    res.set({
      'X-Content-Type-Options': 'nosniff',
      'Referrer-Policy': 'no-referrer',
      'X-Frame-Options': 'DENY',
      'Cache-Control': 'no-store',
    });
    next();
  });
  app.use(express.json({ limit: '32kb' }));
  const bootstrapStatus = options.bootstrap ? { mode: 'bootstrap', applicationReady: false } : {};
  app.get('/api/v1/health', (_req, res) =>
    res.json({ status: 'ok', phase: 1, ...bootstrapStatus }),
  );
  app.get('/api/v1/health/ready', async (_req, res) => {
    try {
      await options.checkDatabase();
      res.json({ status: 'ready', database: 'connected', ...bootstrapStatus });
    } catch {
      res.status(503).json({
        error: 'Database, migrations or configured image storage unavailable',
        code: 'NOT_READY',
      });
    }
  });
  if (options.bootstrap) {
    app.use((_req, res) =>
      res.status(503).json({
        error:
          'Backend infrastructure is running. Application APIs remain disabled until frontend and proxy configuration is complete.',
        code: 'BOOTSTRAP_MODE',
      }),
    );
  }
  if (options.db && !options.bootstrap) {
    app.use('/api/v1/products', imagesRouter(options.db, origins, options.imageStorage));
    app.use('/api/v1/auth', authRouter(options.db, { ...options, webOrigins: origins }));
    app.use('/api/v1/inventory', inventoryRouter(options.db, origins));
    app.use('/api/v1/sales', salesRouter(options.db, origins));
    app.use('/api/v1/reports', reportsRouter(options.db, origins));
    const management = managementRouter(options.db, origins);
    app.use('/api/v1', (req, res, next) => {
      if (/^\/(staff|settings|account|customers|expenses)(\/|$)/.test(req.path))
        management(req, res, next);
      else next();
    });
    const catalogue = catalogueRouter(options.db, origins);
    app.use('/api/v1', (req, res, next) => {
      if (/^\/(business|products|categories|suppliers)(\/|$)/.test(req.path))
        catalogue(req, res, next);
      else next();
    });
  }
  for (const module of [
    'auth',
    'business',
    'categories',
    'suppliers',
    'products',
    'inventory',
    'sales',
    'reports',
    'staff',
  ]) {
    app.use('/api/v1/' + module, (_req, res) => {
      res
        .status(501)
        .json({ error: 'Planned workflow; unavailable in this phase', code: 'NOT_IMPLEMENTED' });
    });
  }
  app.use((_req, res) => res.status(404).json({ error: 'Route not found', code: 'NOT_FOUND' }));
  const errors: ErrorRequestHandler = (error: unknown, _req, res, _next) => {
    if (error instanceof ApiError) {
      res.status(error.status).json({ error: error.message, code: error.code });
    } else if (error instanceof z.ZodError) {
      res.status(400).json({
        error: 'Please correct the highlighted fields',
        code: 'VALIDATION_ERROR',
        issues: error.issues.map((issue) => ({
          path: issue.path.join('.'),
          message: issue.message,
        })),
      });
    } else if (error instanceof Prisma.PrismaClientKnownRequestError && error.code === 'P2002') {
      res.status(409).json({
        error: 'SKU, barcode or category name already exists in this business',
        code: 'DUPLICATE_RECORD',
      });
    } else if (error instanceof Prisma.PrismaClientKnownRequestError && error.code === 'P2003') {
      res.status(409).json({
        error: 'Related record is unavailable or outside this business',
        code: 'INVALID_REFERENCE',
      });
    } else if (error instanceof SyntaxError && 'body' in error) {
      res.status(400).json({ error: 'Invalid JSON body', code: 'INVALID_JSON' });
    } else if (
      typeof error === 'object' &&
      error !== null &&
      'status' in error &&
      error.status === 413
    ) {
      res.status(413).json({ error: 'Request body too large', code: 'PAYLOAD_TOO_LARGE' });
    } else {
      console.error(
        JSON.stringify({
          event: 'api_request_failed',
          error: error instanceof Error ? error.name : 'UnknownError',
          ...(error instanceof Prisma.PrismaClientKnownRequestError ? { code: error.code } : {}),
        }),
      );
      res.status(500).json({ error: 'Unexpected server error', code: 'INTERNAL_ERROR' });
    }
  };
  app.use(errors);
  return app;
}
