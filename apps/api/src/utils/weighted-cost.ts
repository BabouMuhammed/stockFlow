/** Experimental arithmetic only. NOT wired to live inventory; see PURCHASING_DESIGN.md. */
export const WEIGHTED_COST_ACTIVATION = 'REQUIRES_RECONCILED_OPENING_VALUES' as const;
export type CostPool = { quantityThousandths: bigint; valueMinor: bigint };
function valid(pool: CostPool) {
  if (
    pool.quantityThousandths < 0n ||
    pool.valueMinor < 0n ||
    (pool.quantityThousandths === 0n && pool.valueMinor !== 0n)
  )
    throw new Error('Invalid reconciled inventory cost pool');
}
export function addCost(pool: CostPool, quantityThousandths: bigint, valueMinor: bigint): CostPool {
  valid(pool);
  if (quantityThousandths <= 0n || valueMinor < 0n)
    throw new Error('Explicit incoming quantity and cost required');
  return {
    quantityThousandths: pool.quantityThousandths + quantityThousandths,
    valueMinor: pool.valueMinor + valueMinor,
  };
}
// Shared by sales, damage and negative adjustments. Final issue consumes the residual.
export function issueCost(pool: CostPool, quantityThousandths: bigint) {
  valid(pool);
  if (quantityThousandths <= 0n || quantityThousandths > pool.quantityThousandths)
    throw new Error('Insufficient reconciled inventory');
  const allocatedMinor =
    (pool.valueMinor * quantityThousandths + pool.quantityThousandths / 2n) /
    pool.quantityThousandths;
  return {
    allocatedMinor,
    pool: {
      quantityThousandths: pool.quantityThousandths - quantityThousandths,
      valueMinor: pool.valueMinor - allocatedMinor,
    },
  };
}
export function returnedCost(
  saleCostMinor: bigint,
  soldQuantity: bigint,
  previouslyReturned: bigint,
  returnedNow: bigint,
) {
  if (
    saleCostMinor < 0n ||
    soldQuantity <= 0n ||
    previouslyReturned < 0n ||
    returnedNow <= 0n ||
    previouslyReturned + returnedNow > soldQuantity
  )
    throw new Error('Invalid historical cost allocation');
  const cumulative = (q: bigint) => (saleCostMinor * q + soldQuantity / 2n) / soldQuantity;
  return cumulative(previouslyReturned + returnedNow) - cumulative(previouslyReturned);
}
