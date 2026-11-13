import type { Prisma } from '@prisma/client';
import { ApiError } from '../utils/http';
import { lockKey } from './operations';

export async function allocateStockReceiptReference(
  tx: Prisma.TransactionClient,
  businessId: string,
) {
  await lockKey(tx, businessId, 'stock-receipt-reference');
  for (;;) {
    const counter = await tx.stockReceiptCounter.upsert({
      where: { businessId },
      create: { businessId, nextValue: 1n },
      update: {},
      select: { nextValue: true },
    });
    if (counter.nextValue >= 9223372036854775807n)
      throw new ApiError(
        409,
        'REFERENCE_EXHAUSTED',
        'Stock receipt numbering has reached its supported limit',
      );
    // Use Prisma's mutation path so serialization failures become retryable P2034 errors.
    const advanced = await tx.stockReceiptCounter.update({
      where: { businessId },
      data: { nextValue: { increment: 1n } },
      select: { nextValue: true },
    });
    const reference = 'SR-' + (advanced.nextValue - 1n).toString().padStart(6, '0');
    // Also avoid historical/imported reference strings without renumbering them.
    if (
      !(await tx.stockReceipt.findFirst({
        where: { businessId, OR: [{ reference }, { internalReference: reference }] },
        select: { id: true },
      }))
    )
      return reference;
  }
}
