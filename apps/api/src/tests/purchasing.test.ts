import { describe, expect, it } from 'vitest';
import { randomUUID } from 'node:crypto';
import {
  purchaseTotal,
  receiptAmounts,
  receiveInput,
  settlementInput,
} from '../modules/purchasing';
import { validateOperatingCategory } from '../modules/management';
import { fingerprint } from '../modules/operations';
import { addCost, issueCost, returnedCost, WEIGHTED_COST_ACTIVATION } from '../utils/weighted-cost';

const item = () => ({ productId: randomUUID(), quantity: '1', unitCostMinor: '101' });
const body = () => ({
  supplierId: randomUUID(),
  reference: 'INV-1',
  idempotencyKey: randomUUID(),
  items: [item()],
});
describe('purchasing validation and exact totals', () => {
  it('accepts optional supplier documents, rejects supplied internal codes and preserves legacy retry fingerprints', () => {
    const legacy = body();
    const withoutInvoice = { ...legacy, reference: undefined };
    expect(receiveInput.safeParse(withoutInvoice).success).toBe(true);
    expect(
      receiveInput.safeParse({ ...withoutInvoice, supplierInvoiceReference: '' }).success,
    ).toBe(true);
    expect(
      receiveInput.safeParse({ ...withoutInvoice, internalReference: 'SR-000001' }).success,
    ).toBe(false);
    expect(
      receiveInput.safeParse({ ...legacy, supplierInvoiceReference: 'DIFFERENT' }).success,
    ).toBe(false);
    const parsed = receiveInput.parse(legacy);
    expect(fingerprint(parsed)).toBe(
      fingerprint({
        supplierId: parsed.supplierId,
        reference: parsed.reference,
        idempotencyKey: parsed.idempotencyKey,
        notes: '',
        items: parsed.items,
      }),
    );
  });
  it('accepts legacy and multi-product receipts, without trusting client totals', () => {
    const b = body();
    expect(receiveInput.parse(b).items).toHaveLength(1);
    const { items, ...rest } = b;
    expect(receiveInput.parse({ ...rest, ...items[0] }).items).toHaveLength(1);
    expect(receiveInput.safeParse({ ...b, totalMinor: '1' }).success).toBe(false);
    expect(receiveInput.safeParse({ ...b, items: [b.items[0], b.items[0]] }).success).toBe(false);
  });
  it.each(['0', '-1', '1.0001', 'not-a-quantity'])('rejects invalid quantity %s', (quantity) => {
    expect(receiveInput.safeParse({ ...body(), items: [{ ...item(), quantity }] }).success).toBe(
      false,
    );
  });
  it.each(['-1', '1.2', '9223372036854775808'])('rejects invalid unit cost %s', (unitCostMinor) => {
    expect(
      receiveInput.safeParse({ ...body(), items: [{ ...item(), unitCostMinor }] }).success,
    ).toBe(false);
  });
  it('rounds each fractional line half up, adds exactly and checks extended and aggregate overflow', () => {
    expect(
      purchaseTotal([
        { quantity: '0.5', unitCostMinor: 101n },
        { quantity: '1', unitCostMinor: 20n },
      ]),
    ).toBe(71n);
    expect(
      purchaseTotal([
        { quantity: '1', unitCostMinor: 10n },
        { quantity: '1', unitCostMinor: 20n },
      ]),
    ).toBe(30n);
    expect(() => purchaseTotal([{ quantity: '2', unitCostMinor: 9223372036854775807n }])).toThrow();
    expect(() =>
      purchaseTotal([
        { quantity: '1', unitCostMinor: 9223372036854775807n },
        { quantity: '1', unitCostMinor: 1n },
      ]),
    ).toThrow();
    // Old receipts were not range checked; their recorded values remain readable.
    expect(purchaseTotal([{ quantity: '2', unitCostMinor: 9223372036854775807n }], false)).toBe(
      18446744073709551614n,
    );
  });
  it('derives states and retains unknown historical liabilities', () => {
    const receipt = {
      items: [{ quantity: '1', unitCostMinor: 1200000n }],
      payments: [],
      settlementKnown: true,
    };
    expect(receiptAmounts(receipt).paymentStatus).toBe('UNPAID');
    expect(receiptAmounts({ ...receipt, settlementKnown: false })).toMatchObject({
      paymentStatus: 'UNRECONCILED',
      outstandingMinor: null,
    });
    const payments = [
      { amountMinor: 700000n, reversalOfId: null },
      { amountMinor: 300000n, reversalOfId: null },
    ];
    expect(receiptAmounts({ ...receipt, payments })).toMatchObject({
      paymentStatus: 'PARTIALLY_PAID',
      outstandingMinor: 200000n,
    });
    expect(
      receiptAmounts({
        ...receipt,
        payments: [...payments, { amountMinor: 200000n, reversalOfId: null }],
      }).paymentStatus,
    ).toBe('PAID');
    expect(
      receiptAmounts({
        ...receipt,
        payments: [...payments, { amountMinor: 300000n, reversalOfId: 'reversed' }],
      }).paidMinor,
    ).toBe(700000n);
  });
  it('requires actual payment confirmation, positive exact amounts and external references', () => {
    const b = {
      amountMinor: '100',
      date: '2026-01-01',
      method: 'CASH',
      confirmed: true,
      idempotencyKey: randomUUID(),
    };
    expect(settlementInput.safeParse(b).success).toBe(true);
    for (const amountMinor of ['0', '-1', '1.2'])
      expect(settlementInput.safeParse({ ...b, amountMinor }).success).toBe(false);
    expect(settlementInput.safeParse({ ...b, confirmed: false }).success).toBe(false);
    expect(settlementInput.safeParse({ ...b, method: 'BANK_TRANSFER' }).success).toBe(false);
    expect(settlementInput.safeParse({ ...b, date: '2999-01-01' }).success).toBe(false);
  });
  it('blocks obvious inventory expense categories and preserves normal operating categories', () => {
    for (const name of ['Inventory purchases', 'Stock purchase', 'Supplier payments', 'COGS'])
      expect(() => validateOperatingCategory(name)).toThrow();
    for (const name of ['Rent', 'Electricity', 'Staff salaries', 'Transportation'])
      expect(() => validateOperatingCategory(name)).not.toThrow();
  });
});
describe('disabled weighted-average arithmetic, with explicit cost pools', () => {
  it('keeps activation gated and calculates D150 average for different purchase prices', () => {
    expect(WEIGHTED_COST_ACTIVATION).toBe('REQUIRES_RECONCILED_OPENING_VALUES');
    const pool = addCost({ quantityThousandths: 10000n, valueMinor: 100000n }, 10000n, 200000n);
    expect(pool).toEqual({ quantityThousandths: 20000n, valueMinor: 300000n });
    expect(issueCost(pool, 1000n).allocatedMinor).toBe(15000n);
  });
  it('preserves every butut across fractional sales, damage and negative adjustments', () => {
    let pool = { quantityThousandths: 3000n, valueMinor: 100n };
    let total = 0n;
    for (const quantity of [500n, 1000n, 1500n]) {
      const issue = issueCost(pool, quantity);
      total += issue.allocatedMinor;
      pool = issue.pool;
    }
    expect(total).toBe(100n);
    expect(pool.valueMinor).toBe(0n);
    expect(() => issueCost(pool, 1n)).toThrow();
  });
  it('adds returns at original allocated cost, without revaluing historical snapshots', () => {
    const historicalCost = 101n;
    const first = returnedCost(historicalCost, 1000n, 0n, 500n);
    const second = returnedCost(historicalCost, 1000n, 500n, 500n);
    expect(first + second).toBe(historicalCost);
    expect(
      addCost({ quantityThousandths: 0n, valueMinor: 0n }, 1000n, first + second).valueMinor,
    ).toBe(101n);
    expect(() => addCost({ quantityThousandths: 0n, valueMinor: 1n }, 1n, 1n)).toThrow();
  });
});
