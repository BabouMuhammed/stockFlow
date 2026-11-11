import { MAX_MINOR } from './validation';

// Only decimal strings enter this boundary: never coerce a JSON floating-point number.
export function parseGmdAmount(input: string): bigint {
  const value = input.trim();
  if (value.startsWith('-')) throw new Error('Amount received cannot be negative');
  if (/^\d+\.\d{3,}$/.test(value))
    throw new Error(
      'GMD amounts allow at most two decimal places. Extra decimal places are not rounded.',
    );
  if (value.length > 22 || !/^\d+(\.\d{1,2})?$/.test(value))
    throw new Error('Enter a valid GMD amount, such as 390, 390.5 or 390.50');
  const [whole, fraction = ''] = value.split('.');
  const minor = BigInt(whole) * 100n + BigInt(fraction.padEnd(2, '0'));
  if (minor > MAX_MINOR) throw new Error('Amount exceeds the supported range');
  return minor;
}
export function quantityThousandths(value: string): bigint {
  if (!/^(0|[1-9][0-9]{0,14})(\.[0-9]{1,3})?$/.test(value))
    throw new Error('Use a nonnegative quantity with up to three decimal places');
  const [whole, fraction = ''] = value.split('.');
  return BigInt(whole) * 1000n + BigInt(fraction.padEnd(3, '0'));
}
export function proratedMinor(totalMinor: bigint, part: bigint, whole: bigint): bigint {
  if (totalMinor < 0n || part < 0n || whole <= 0n || part > whole)
    throw new Error('Invalid monetary allocation');
  return (totalMinor * part + whole / 2n) / whole;
}
export function extendedMinor(unitMinor: bigint, thousandths: bigint): bigint {
  if (unitMinor < 0n || thousandths < 0n)
    throw new Error('Amounts and quantities cannot be negative');
  return (unitMinor * thousandths + 500n) / 1000n;
}
