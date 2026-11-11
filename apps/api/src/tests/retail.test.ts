import { describe, expect, it } from 'vitest';
import { lineMoney } from '../modules/operations';
import { checkoutInput, discountedTotal } from '../modules/sales';
import { csvCell } from '../modules/reports';
import { randomUUID } from 'node:crypto';
describe('exact retail calculations and validation', () => {
  it('calculates whole and fractional quantities in integer minor units with half-up rounding', () => {
    expect(lineMoney(13000n, '3')).toBe(39000n);
    expect(lineMoney(101n, '0.5')).toBe(51n);
    expect(lineMoney(9223372036854775807n, '1')).toBe(9223372036854775807n);
    expect(() => lineMoney(9223372036854775807n, '2')).toThrow();
  });
  it('calculates fixed and percentage discounts without floating point', () => {
    expect(discountedTotal(39000n, { type: 'FIXED', amountMinor: 1000n })).toEqual({
      discountMinor: 1000n,
      totalMinor: 38000n,
    });
    expect(discountedTotal(39000n, { type: 'PERCENT', basisPoints: 1000 })).toEqual({
      discountMinor: 3900n,
      totalMinor: 35100n,
    });
    expect(() => discountedTotal(100n, { type: 'FIXED', amountMinor: 101n })).toThrow();
  });
  it('rejects duplicated cart lines, fractional money and client-supplied prices', () => {
    const item = { productId: randomUUID(), quantity: '1' },
      valid = {
        idempotencyKey: randomUUID(),
        items: [item],
        paymentMethod: 'CASH',
        amountReceivedMinor: '50000',
      };
    expect(checkoutInput.safeParse(valid).success).toBe(true);
    expect(checkoutInput.safeParse({ ...valid, items: [item, item] }).success).toBe(false);
    expect(checkoutInput.safeParse({ ...valid, amountReceivedMinor: '1.2' }).success).toBe(false);
    expect(checkoutInput.safeParse({ ...valid, items: [{ ...item, price: '1' }] }).success).toBe(
      false,
    );
  });
  it('escapes CSV formulas, commas, quotes and newlines', () => {
    expect(csvCell('=SUM(A1)')).toBe('"\'=SUM(A1)"');
    expect(csvCell('a,"b"\nc')).toBe('"a,""b""\nc"');
  });
});
