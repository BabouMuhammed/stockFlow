import { randomBytes, scrypt, timingSafeEqual } from 'node:crypto';
const options = { N: 131072, r: 8, p: 1, maxmem: 256 * 1024 * 1024 };
function derive(password: string, salt: Buffer): Promise<Buffer> {
  return new Promise((resolve, reject) =>
    scrypt(password, salt, 64, options, (error, result) =>
      error ? reject(error) : resolve(result),
    ),
  );
}
export async function hashPassword(password: string): Promise<string> {
  if (password.length < 12 || password.length > 128)
    throw new Error('Password must contain 12 to 128 characters');
  const salt = randomBytes(16);
  const key = await derive(password, salt);
  return ['scrypt', 'v1', salt.toString('hex'), key.toString('hex')].join('$');
}
export async function verifyPassword(password: string, stored: string): Promise<boolean> {
  if (password.length < 1 || password.length > 128) return false;
  const [algorithm, version, salt, key] = stored.split('$');
  if (
    algorithm !== 'scrypt' ||
    version !== 'v1' ||
    !/^[a-f0-9]{32}$/.test(salt ?? '') ||
    !/^[a-f0-9]{128}$/.test(key ?? '')
  )
    return false;
  const actual = await derive(password, Buffer.from(salt, 'hex'));
  return timingSafeEqual(actual, Buffer.from(key, 'hex'));
}
