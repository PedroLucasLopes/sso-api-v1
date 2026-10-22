export const LOGO_MAX_BYTES = 48 * 1024;

export const LOGO_MAX_DATA_URI_LENGTH =
  'data:image/jpeg;base64,'.length + Math.ceil(LOGO_MAX_BYTES / 3) * 4;

export const PROJECT_DISPLAY_NAME_MAX_LENGTH = 60;

const DATA_URI =
  /^data:(image\/(?:png|jpeg|webp));base64,([A-Za-z0-9+/]+={0,2})$/;

const PNG_SIGNATURE = Buffer.from([
  0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a,
]);

const SIGNATURES: Record<string, (bytes: Buffer) => boolean> = {
  'image/png': (bytes) => bytes.subarray(0, 8).equals(PNG_SIGNATURE),
  'image/jpeg': (bytes) =>
    bytes[0] === 0xff && bytes[1] === 0xd8 && bytes[2] === 0xff,
  'image/webp': (bytes) =>
    bytes.subarray(0, 4).toString('ascii') === 'RIFF' &&
    bytes.subarray(8, 12).toString('ascii') === 'WEBP',
};

export function logoProblem(
  value: string,
): 'logo_invalid' | 'logo_too_large' | null {
  if (value.length > LOGO_MAX_DATA_URI_LENGTH) return 'logo_too_large';

  const match = DATA_URI.exec(value);

  if (!match) return 'logo_invalid';

  const [, type, payload] = match;
  const bytes = Buffer.from(payload, 'base64');

  if (bytes.length === 0) return 'logo_invalid';
  if (bytes.length > LOGO_MAX_BYTES) return 'logo_too_large';

  return SIGNATURES[type](bytes) ? null : 'logo_invalid';
}
