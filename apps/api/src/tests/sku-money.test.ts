import { describe, expect, it } from 'vitest';
import { randomUUID } from 'node:crypto';
import { parseGmdAmount, proratedMinor } from '../utils/money';
import { checkoutInput } from '../modules/sales';
import { fingerprint, lineMoney } from '../modules/operations';
import { productCreateInput, productUpdate } from '../utils/validation';

describe('natural GMD input and exact financial arithmetic', () => {
  it.each([
    ['390', 39000n],
    ['390.5', 39050n],
    ['390.50', 39050n],
    ['1000', 100000n],
    ['1000.75', 100075n],
    ['0.01', 1n],
    ['0.10', 10n],
    [' 700 ', 70000n],
  ])('parses %s exactly', (input, expected) =>
    expect(parseGmdAmount(input as string)).toBe(expected),
  );
  it.each(['-1', '390.501', '0.001', 'abc', '1e3', '1,000', '390.', 'Infinity', 'NaN', ''])(
    'rejects invalid input without rounding: %s',
    (input) => expect(() => parseGmdAmount(input)).toThrow(),
  );
  it('adds 0.10 and 0.20 exactly and calculates the required change', () => {
    expect(parseGmdAmount('0.10') + parseGmdAmount('0.20')).toBe(30n);
    expect(parseGmdAmount('700') - lineMoney(52900n, '1.25')).toBe(3875n);
    expect(lineMoney(1n, '0.5')).toBe(1n);
    expect(lineMoney(101n, '0.5')).toBe(51n);
    expect(() => lineMoney(101n, '0.5001')).toThrow();
  });
  it('keeps legacy minor-unit checkout payloads and retry hashes unambiguous', () => {
    const input = {
      idempotencyKey: randomUUID(),
      items: [{ productId: randomUUID(), quantity: '1' }],
      paymentMethod: 'CASH',
      amountReceivedMinor: '70000',
      manualConfirmation: false,
    };
    const legacy = checkoutInput.parse(input);
    const decimal = checkoutInput.parse({
      ...input,
      amountReceivedMinor: undefined,
      amountReceived: '700',
    });
    expect(decimal).toEqual(legacy);
    expect(fingerprint(legacy)).toBe(fingerprint({ ...input, amountReceivedMinor: 70000n }));
    expect(checkoutInput.safeParse({ ...input, amountReceived: '700' }).success).toBe(false);
    expect(checkoutInput.safeParse({ ...input, amountReceivedMinor: undefined }).success).toBe(
      false,
    );
    expect(
      checkoutInput.safeParse({ ...input, amountReceivedMinor: undefined, amountReceived: 700 })
        .success,
    ).toBe(false);
    expect(checkoutInput.safeParse({ ...input, amountReceivedMinor: '700.00' }).success).toBe(
      false,
    );
  });
  it('prorates large refunds with integer arithmetic and half-up rounding', () => {
    expect(proratedMinor(9223372036854775807n, 1n, 3n)).toBe(3074457345618258602n);
    expect(proratedMinor(101n, 1n, 2n)).toBe(51n);
    expect(proratedMinor(101n, 2n, 2n) - proratedMinor(101n, 1n, 2n)).toBe(50n);
  });
  it('accepts explicit exact cash only, without an ambiguous amount', () => {
    const input = {
      idempotencyKey: randomUUID(),
      items: [{ productId: randomUUID(), quantity: '1.25' }],
      paymentMethod: 'CASH',
      exactPayment: true,
    };
    expect(checkoutInput.parse(input)).toMatchObject({ exactPayment: true });
    for (const extra of [
      { amountReceived: '4750' },
      { amountReceivedMinor: '475000' },
      { amountReceived: '' },
      { paymentMethod: 'BANK_TRANSFER' },
      { paymentMethod: 'MOBILE_MONEY' },
      { paymentMethod: 'CARD' },
      { totalMinor: '1' },
    ])
      expect(checkoutInput.safeParse({ ...input, ...extra }).success).toBe(false);
  });
});
describe('optional custom SKU validation', () => {
  const input = { name: 'Product', purchaseCostMinor: '100', sellingPriceMinor: '150' };
  it('permits omitted or blank create SKUs, trims custom codes and keeps PATCH fields absent', () => {
    expect(productCreateInput.parse(input).sku).toBeUndefined();
    expect(productCreateInput.parse({ ...input, sku: '  ' }).sku).toBe('');
    expect(productCreateInput.parse({ ...input, sku: ' SHOP-12 ', barcode: 'BAR-1' }).sku).toBe(
      'SHOP-12',
    );
    expect(productUpdate.parse({ name: 'Renamed' })).toEqual({ name: 'Renamed' });
    expect(productUpdate.safeParse({ sku: '' }).success).toBe(false);
  });
});
