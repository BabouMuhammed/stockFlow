import { PrismaClient } from '@prisma/client';
import { createApp } from './app';
import { readEnv, listenHost } from './config/env';
import { imageStorageFromEnv, checkImageStorage } from './config/storage';
const env = readEnv();
const imageStorage = imageStorageFromEnv(env);
const prisma = new PrismaClient();
const app = createApp({
  db: prisma,
  webOrigin: env.WEB_ORIGIN,
  webOrigins: env.WEB_ORIGINS,
  sessionHours: env.SESSION_HOURS,
  cookieSecure: env.NODE_ENV === 'production',
  trustedProxyCidrs: env.TRUSTED_PROXY_CIDRS,
  imageStorage,
  bootstrap: env.DEPLOYMENT_MODE === 'bootstrap',
  checkDatabase: async () => {
    await prisma.$queryRawUnsafe('SELECT 1');
    await prisma.userSession.count();
    const columns = await prisma.$queryRaw<
      Array<{ data_type: string }>
    >`SELECT data_type FROM information_schema.columns WHERE table_schema=current_schema() AND table_name='Product' AND column_name='sellingPriceMinor'`;
    if (columns[0]?.data_type !== 'bigint') throw new Error('Monetary migration pending');
    await prisma.business.findFirst({ select: { receiptHeader: true } });
    await prisma.saleReturn.count();
    await prisma.productSkuCounter.findFirst({ select: { businessId: true } });
    await checkImageStorage(imageStorage);
  },
});
const server = app.listen(env.PORT, listenHost(env.NODE_ENV), () =>
  console.log('StockFlow API listening on port ' + env.PORT),
);
for (const signal of ['SIGINT', 'SIGTERM'] as const) {
  process.on(signal, () =>
    server.close(() => {
      void prisma.$disconnect().then(() => process.exit(0));
    }),
  );
}
