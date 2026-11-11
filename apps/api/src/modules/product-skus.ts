import type { Prisma } from '@prisma/client';
import { ApiError } from '../utils/http';
import { lockKey } from './operations';

// All API SKU allocations and edits share this business-specific transaction lock.
export const lockProductSkus = (tx: Prisma.TransactionClient, businessId: string) =>
  lockKey(tx, businessId, 'product-sku');
export async function allocateProductSku(
  tx: Prisma.TransactionClient,
  businessId: string,
  custom?: string,
) {
  await lockProductSkus(tx, businessId);
  if (custom) {
    if (
      await tx.product.findUnique({
        where: { businessId_sku: { businessId, sku: custom } },
        select: { id: true },
      })
    )
      throw new ApiError(
        409,
        'DUPLICATE_SKU',
        'This SKU already exists in your business. Choose another custom SKU or use automatic generation.',
      );
    return custom;
  }
  for (;;) {
    const [counter] = await tx.$queryRaw<Array<{ value: bigint }>>`
      INSERT INTO "ProductSkuCounter" ("businessId","nextValue") VALUES (${businessId}::uuid,2)
      ON CONFLICT ("businessId") DO UPDATE SET "nextValue"="ProductSkuCounter"."nextValue"+1
      RETURNING "nextValue"-1 AS value`;
    const sku = 'PRD-' + counter.value.toString().padStart(6, '0');
    // Also skip imported or custom codes occupying a future generated code.
    if (
      !(await tx.product.findUnique({
        where: { businessId_sku: { businessId, sku } },
        select: { id: true },
      }))
    )
      return sku;
  }
}
