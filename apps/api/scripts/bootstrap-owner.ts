import { createInterface } from 'node:readline/promises';
import { emitKeypressEvents } from 'node:readline';
import { PrismaClient } from '@prisma/client';
import { readEnv } from '../src/config/env';
import { assertLocalBootstrap, bootstrapOwner } from '../src/security/bootstrap';
import { ApiError } from '../src/utils/http';

function hiddenPassword(prompt: string): Promise<string> {
  return new Promise((resolve, reject) => {
    let value = '';
    process.stdout.write(prompt);
    emitKeypressEvents(process.stdin);
    process.stdin.setRawMode(true);
    process.stdin.resume();
    const finish = () => {
      process.stdin.removeListener('keypress', onKey);
      process.stdin.setRawMode(false);
      process.stdin.pause();
      process.stdout.write('\n');
    };
    const onKey = (character: string, key: { name?: string; ctrl?: boolean }) => {
      if (key.ctrl && key.name === 'c') {
        finish();
        reject(new Error('Cancelled'));
        return;
      }
      if (key.name === 'return') {
        finish();
        resolve(value);
        return;
      }
      if (key.name === 'backspace') {
        value = value.slice(0, -1);
        return;
      }
      if (
        character &&
        !key.ctrl &&
        Array.from(character).every(
          (char) => char.charCodeAt(0) >= 32 && char.charCodeAt(0) !== 127,
        ) &&
        value.length + character.length <= 128
      )
        value += character;
    };
    process.stdin.on('keypress', onKey);
  });
}
async function main() {
  readEnv();
  assertLocalBootstrap(
    process.env,
    !!process.stdin.isTTY,
    process.argv.includes('--confirm-local-owner'),
  );
  const businessFlag = process.argv.indexOf('--business-id');
  const businessId = businessFlag >= 0 ? process.argv[businessFlag + 1] : undefined;
  if (businessFlag >= 0 && !businessId) throw new Error('Business id is required');
  const prompt = createInterface({ input: process.stdin, output: process.stdout });
  const businessName = businessId
    ? 'Existing business'
    : await prompt.question('New business name: ');
  const name = await prompt.question('Owner name: ');
  const email = await prompt.question('Owner email: ');
  prompt.close();
  const password = await hiddenPassword('Password (12-128 characters, hidden): ');
  const confirmation = await hiddenPassword('Confirm password (hidden): ');
  if (password !== confirmation) throw new Error('Passwords do not match');
  const db = new PrismaClient();
  try {
    const result = await bootstrapOwner(db, { businessId, businessName, name, email, password });
    console.log('Owner created. Business ID: ' + result.businessId);
  } finally {
    await db.$disconnect();
  }
}
main().catch((error) => {
  console.error(
    error instanceof ApiError
      ? error.message
      : 'Bootstrap failed. Check inputs and database access; existing accounts were not overwritten.',
  );
  process.exitCode = 1;
});
