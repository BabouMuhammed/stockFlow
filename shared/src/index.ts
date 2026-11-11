export function formatMoney(minor: number | string | bigint): string {
  if (
    (typeof minor === 'number' && !Number.isSafeInteger(minor)) ||
    (typeof minor === 'string' && !/^-?(0|[1-9][0-9]*)$/.test(minor))
  )
    throw new Error('Money must be integer minor units');
  const value = BigInt(minor);
  const absolute = value < 0n ? -value : value;
  return (
    (value < 0n ? '-D ' : 'D ') +
    (absolute / 100n).toLocaleString('en-GB') +
    '.' +
    (absolute % 100n).toString().padStart(2, '0')
  );
}
export const demoProducts = [
  {
    sku: 'RICE-25',
    name: 'Rice 25kg',
    category: 'Rice and grains',
    price: 220000,
    quantity: '18.000',
    cost: 185000,
  },
  {
    sku: 'SUG-1KG',
    name: 'Sugar 1kg',
    category: 'Rice and grains',
    price: 9500,
    quantity: '35.000',
    cost: 7500,
  },
  {
    sku: 'OIL-1L',
    name: 'Cooking Oil 1L',
    category: 'Cooking essentials',
    price: 13500,
    quantity: '22.000',
    cost: 10500,
  },
  {
    sku: 'MLK-1L',
    name: 'Milk 1L',
    category: 'Dairy',
    price: 12000,
    quantity: '16.000',
    cost: 9500,
  },
  {
    sku: 'WAT-15',
    name: 'Bottled Water 1.5L',
    category: 'Beverages',
    price: 2500,
    quantity: '42.000',
    cost: 1800,
  },
  {
    sku: 'FLR-1KG',
    name: 'Flour 1kg',
    category: 'Rice and grains',
    price: 8500,
    quantity: '26.000',
    cost: 6500,
  },
  {
    sku: 'SODA-500',
    name: 'Soft Drink 500ml',
    category: 'Beverages',
    price: 3500,
    quantity: '30.000',
    cost: 2500,
  },
  {
    sku: 'SOAP-01',
    name: 'Laundry Soap',
    category: 'Household products',
    price: 6000,
    quantity: '12.000',
    cost: 4500,
  },
] as const;
export type DemoProduct = (typeof demoProducts)[number];

export const MAX_MINOR = 9223372036854775807n;
export function parseMoneyInput(value: string): string {
  const input = value.trim();
  if (input.startsWith('-')) throw new Error('Amount received cannot be negative');
  if (/^\d+\.\d{3,}$/.test(input))
    throw new Error(
      'GMD amounts allow at most two decimal places. Extra decimal places are not rounded.',
    );
  if (!/^\d+(\.[0-9]{1,2})?$/.test(input) || input.length > 22)
    throw new Error('Enter a valid GMD amount, such as 390, 390.5 or 390.50');
  const [whole, fraction = ''] = input.split('.');
  const minor = BigInt(whole) * 100n + BigInt(fraction.padEnd(2, '0'));
  if (minor > MAX_MINOR) throw new Error('Amount exceeds the supported range');
  return minor.toString();
}
export function moneyInputValue(minor: string): string {
  const value = BigInt(minor);
  return (value / 100n).toString() + '.' + (value % 100n).toString().padStart(2, '0');
}
export function parseQuantityInput(value: string): bigint {
  if (!/^(0|[1-9][0-9]{0,14})(\.[0-9]{1,3})?$/.test(value))
    throw new Error('Use a nonnegative quantity with up to three decimal places');
  const [whole, fraction = ''] = value.split('.');
  return BigInt(whole) * 1000n + BigInt(fraction.padEnd(3, '0'));
}
export function quantityInputValue(thousandths: bigint): string {
  if (thousandths < 0n) throw new Error('Quantity cannot be negative');
  const fraction = (thousandths % 1000n).toString().padStart(3, '0').replace(/0+$/, '');
  return (thousandths / 1000n).toString() + (fraction ? '.' + fraction : '');
}
