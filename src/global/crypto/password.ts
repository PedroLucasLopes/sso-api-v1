import {
  randomBytes,
  randomInt,
  scrypt,
  timingSafeEqual,
  type ScryptOptions,
} from 'node:crypto';

const scryptAsync = (
  password: string,
  salt: Buffer,
  keyLength: number,
  options: ScryptOptions,
): Promise<Buffer> =>
  new Promise((resolve, reject) => {
    scrypt(password, salt, keyLength, options, (error, key) =>
      error ? reject(error) : resolve(key),
    );
  });

const COST = 2 ** 16;
const BLOCK_SIZE = 8;
const PARALLELISM = 1;
const KEY_BYTES = 32;
const SALT_BYTES = 16;
const MAX_MEMORY = 256 * 1024 * 1024;

export const MIN_PASSWORD_LENGTH = 12;
export const MAX_PASSWORD_LENGTH = 200;

const ALPHABET = 'ABCDEFGHJKLMNPQRSTUVWXYZabcdefghijkmnopqrstuvwxyz23456789';

const derive = async (password: string, salt: Buffer): Promise<Buffer> =>
  scryptAsync(password.normalize('NFKC'), salt, KEY_BYTES, {
    N: COST,
    r: BLOCK_SIZE,
    p: PARALLELISM,
    maxmem: MAX_MEMORY,
  });

export async function hashPassword(password: string): Promise<string> {
  const salt = randomBytes(SALT_BYTES);
  const key = await derive(password, salt);

  return [
    'scrypt',
    COST,
    BLOCK_SIZE,
    PARALLELISM,
    salt.toString('base64url'),
    key.toString('base64url'),
  ].join('$');
}

export async function verifyPassword(
  password: string,
  stored: string,
): Promise<boolean> {
  const [scheme, cost, blockSize, parallelism, salt, key] = stored.split('$');

  if (scheme !== 'scrypt' || !salt || !key) return false;

  const expected = Buffer.from(key, 'base64url');

  let candidate: Buffer;

  try {
    candidate = await scryptAsync(
      password.normalize('NFKC'),
      Buffer.from(salt, 'base64url'),
      expected.length,
      {
        N: Number(cost),
        r: Number(blockSize),
        p: Number(parallelism),
        maxmem: MAX_MEMORY,
      },
    );
  } catch {
    return false;
  }

  return (
    candidate.length === expected.length && timingSafeEqual(candidate, expected)
  );
}

export function generatePassword(length = 16): string {
  return Array.from(
    { length },
    () => ALPHABET[randomInt(ALPHABET.length)],
  ).join('');
}

export function passwordProblem(password: string): string | null {
  const value = password.normalize('NFKC');

  if (value.length < MIN_PASSWORD_LENGTH) return 'too_short';
  if (value.length > MAX_PASSWORD_LENGTH) return 'too_long';
  if (value.trim().length !== value.length) return 'padded';
  if (new Set(value).size < 5) return 'too_repetitive';

  return null;
}
