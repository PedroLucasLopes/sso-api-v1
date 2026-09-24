import {
  createHmac,
  randomBytes,
  randomInt,
  timingSafeEqual,
} from 'node:crypto';

const BASE32 = 'ABCDEFGHIJKLMNOPQRSTUVWXYZ234567';

export const TOTP_STEP_SECONDS = 30;
export const TOTP_DIGITS = 6;
export const TOTP_WINDOW = 1;

const RECOVERY_ALPHABET = '23456789ABCDEFGHJKLMNPQRSTUVWXYZ';
const RECOVERY_GROUPS = 2;
const RECOVERY_GROUP_SIZE = 5;

export function encodeBase32(buffer: Buffer): string {
  let bits = 0;
  let value = 0;
  let output = '';

  for (const byte of buffer) {
    value = (value << 8) | byte;
    bits += 8;

    while (bits >= 5) {
      output += BASE32[(value >>> (bits - 5)) & 31];
      bits -= 5;
    }
  }

  if (bits > 0) output += BASE32[(value << (5 - bits)) & 31];

  return output;
}

export function decodeBase32(secret: string): Buffer {
  const clean = secret.replace(/[\s=]/g, '').toUpperCase();
  const bytes: number[] = [];
  let bits = 0;
  let value = 0;

  for (const character of clean) {
    const index = BASE32.indexOf(character);

    if (index === -1) throw new Error('segredo TOTP invalido');

    value = (value << 5) | index;
    bits += 5;

    if (bits >= 8) {
      bytes.push((value >>> (bits - 8)) & 255);
      bits -= 8;
    }
  }

  return Buffer.from(bytes);
}

export const generateSecret = (bytes = 20): string =>
  encodeBase32(randomBytes(bytes));

export function codeAt(secret: string, step: number): string {
  const counter = Buffer.alloc(8);

  counter.writeUInt32BE(Math.floor(step / 2 ** 32), 0);
  counter.writeUInt32BE(step >>> 0, 4);

  const digest = createHmac('sha1', decodeBase32(secret))
    .update(counter)
    .digest();
  const offset = digest[digest.length - 1] & 15;
  const binary =
    ((digest[offset] & 127) << 24) |
    ((digest[offset + 1] & 255) << 16) |
    ((digest[offset + 2] & 255) << 8) |
    (digest[offset + 3] & 255);

  return String(binary % 10 ** TOTP_DIGITS).padStart(TOTP_DIGITS, '0');
}

export const stepAt = (at: Date = new Date()): number =>
  Math.floor(at.getTime() / 1000 / TOTP_STEP_SECONDS);

export function verifyCode(
  secret: string,
  code: string,
  options: { at?: Date; lastStep?: number | null } = {},
): { ok: boolean; step?: number } {
  const clean = code.replace(/\D/g, '');

  if (clean.length !== TOTP_DIGITS) return { ok: false };

  const current = stepAt(options.at);

  for (let drift = -TOTP_WINDOW; drift <= TOTP_WINDOW; drift += 1) {
    const step = current + drift;

    if (options.lastStep !== null && options.lastStep !== undefined) {
      if (step <= options.lastStep) continue;
    }

    const expected = Buffer.from(codeAt(secret, step));
    const candidate = Buffer.from(clean);

    if (
      candidate.length === expected.length &&
      timingSafeEqual(candidate, expected)
    ) {
      return { ok: true, step };
    }
  }

  return { ok: false };
}

export function otpauthUrl(options: {
  secret: string;
  email: string;
  issuer: string;
}): string {
  const label = encodeURIComponent(`${options.issuer}:${options.email}`);
  const query = new URLSearchParams({
    secret: options.secret,
    issuer: options.issuer,
    algorithm: 'SHA1',
    digits: String(TOTP_DIGITS),
    period: String(TOTP_STEP_SECONDS),
  });

  return `otpauth://totp/${label}?${query.toString()}`;
}

export const generateRecoveryCode = (): string =>
  Array.from({ length: RECOVERY_GROUPS }, () =>
    Array.from(
      { length: RECOVERY_GROUP_SIZE },
      () => RECOVERY_ALPHABET[randomInt(RECOVERY_ALPHABET.length)],
    ).join(''),
  ).join('-');

export const normalizeRecoveryCode = (code: string): string =>
  code.replace(/[^0-9A-Za-z]/g, '').toUpperCase();
