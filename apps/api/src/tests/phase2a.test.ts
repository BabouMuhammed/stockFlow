import { describe, expect, it } from 'vitest';
import { productUpdate, supplierUpdate, minorUnits, MAX_MINOR } from '../utils/validation';
import { jsonReplacer } from '../utils/http';
describe('catalogue partial updates and exact JSON', () => {
  it('keeps omitted product/supplier fields absent rather than applying create defaults', () => {
    expect(productUpdate.parse({ name: 'Renamed' })).toEqual({ name: 'Renamed' });
    expect(supplierUpdate.parse({ name: 'Renamed supplier' })).toEqual({
      name: 'Renamed supplier',
    });
    expect(productUpdate.parse({ isActive: false })).toEqual({ isActive: false });
  });
  it('serializes the BIGINT maximum exactly and rejects malformed money without throwing unexpected errors', () => {
    expect(JSON.parse(JSON.stringify({ amount: MAX_MINOR }, jsonReplacer))).toEqual({
      amount: '9223372036854775807',
    });
    for (const value of ['1.25', '-1', '9223372036854775808', 1.25])
      expect(minorUnits.safeParse(value).success).toBe(false);
    expect(minorUnits.parse('9223372036854775807')).toBe(MAX_MINOR);
  });
});
