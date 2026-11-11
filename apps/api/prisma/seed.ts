import '../src/config/env';
import { PrismaClient } from '@prisma/client';
import {
  assertDemoSeedAllowed,
  DEMO_BUSINESS_ID as businessId,
  DEMO_BRANCH_ID as branchId,
} from './demo-policy';
const prisma = new PrismaClient();
const products = [
  ['Rice 25kg', 'RICE-25', 'Rice and grains', 185000, 220000, '18.000'],
  ['Sugar 1kg', 'SUG-1KG', 'Rice and grains', 7500, 9500, '35.000'],
  ['Cooking Oil 1L', 'OIL-1L', 'Cooking essentials', 10500, 13500, '22.000'],
  ['Milk 1L', 'MLK-1L', 'Dairy', 9500, 12000, '16.000'],
  ['Bottled Water 1.5L', 'WAT-15', 'Beverages', 1800, 2500, '42.000'],
  ['Flour 1kg', 'FLR-1KG', 'Rice and grains', 6500, 8500, '26.000'],
  ['Soft Drink 500ml', 'SODA-500', 'Beverages', 2500, 3500, '30.000'],
  ['Laundry Soap', 'SOAP-01', 'Household products', 4500, 6000, '12.000'],
] as const;
async function main() {
  assertDemoSeedAllowed(process.env);
  await prisma.$transaction(
    async (tx) => {
      if (await tx.business.count({ where: { isDemo: false } }))
        throw new Error('Refusing seed: database contains non-demo businesses.');
      const existing = await tx.business.findUnique({ where: { id: businessId } });
      if (existing && (!existing.isDemo || existing.name !== 'StockFlow Demo Mart (illustrative)'))
        throw new Error('Demo identity is occupied.');
      await tx.business.upsert({
        where: { id: businessId },
        update: {},
        create: {
          id: businessId,
          name: 'StockFlow Demo Mart (illustrative)',
          isDemo: true,
          address: 'Serrekunda, The Gambia (illustrative)',
        },
      });
      await tx.branch.upsert({
        where: { businessId_code: { businessId, code: 'DEMO' } },
        update: {},
        create: { id: branchId, businessId, name: 'Illustrative Serrekunda branch', code: 'DEMO' },
      });
      for (const [name, sku, categoryName, cost, price, quantity] of products) {
        if (await tx.product.findUnique({ where: { businessId_sku: { businessId, sku } } }))
          continue;
        const category = await tx.category.upsert({
          where: { businessId_name: { businessId, name: categoryName } },
          update: {},
          create: { businessId, name: categoryName },
        });
        const product = await tx.product.create({
          data: {
            businessId,
            name,
            sku,
            categoryId: category.id,
            purchaseCostMinor: cost,
            sellingPriceMinor: price,
          },
        });
        const receipt = await tx.stockReceipt.create({
          data: {
            businessId,
            branchId,
            reference: 'ILLUSTRATIVE-OPENING-' + sku,
            idempotencyKey: 'DEMO-OPENING-' + sku,
            supplierName: 'Illustrative opening stock',
          },
        });
        await tx.stockReceiptItem.create({
          data: {
            businessId,
            receiptId: receipt.id,
            productId: product.id,
            productName: name,
            quantity,
            unitCostMinor: cost,
          },
        });
        await tx.stockLevel.create({
          data: { businessId, branchId, productId: product.id, quantity },
        });
        await tx.stockMovement.create({
          data: {
            businessId,
            branchId,
            productId: product.id,
            movementType: 'RECEIPT',
            quantityDelta: quantity,
            quantityAfter: quantity,
            referenceType: 'RECEIPT',
            referenceId: receipt.id,
            reason: 'Illustrative opening stock only',
          },
        });
      }
    },
    { isolationLevel: 'Serializable', timeout: 30000 },
  );
  console.log('Illustrative demo data created; existing records were not updated.');
}
main()
  .catch((error: unknown) => {
    console.error(error);
    process.exitCode = 1;
  })
  .finally(() => prisma.$disconnect());
