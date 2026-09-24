import {
  codeAt,
  decodeBase32,
  encodeBase32,
  generateRecoveryCode,
  generateSecret,
  normalizeRecoveryCode,
  otpauthUrl,
  stepAt,
  verifyCode,
} from './totp';

const RFC_SECRET = encodeBase32(Buffer.from('12345678901234567890', 'ascii'));

describe('TOTP', () => {
  it('codifica e decodifica base32 sem perder byte', () => {
    const raw = Buffer.from('12345678901234567890', 'ascii');

    expect(decodeBase32(encodeBase32(raw)).equals(raw)).toBe(true);
  });

  it('bate com os vetores da RFC 6238', () => {
    expect(codeAt(RFC_SECRET, Math.floor(59 / 30))).toBe('287082');
    expect(codeAt(RFC_SECRET, Math.floor(1111111109 / 30))).toBe('081804');
    expect(codeAt(RFC_SECRET, Math.floor(1234567890 / 30))).toBe('005924');
    expect(codeAt(RFC_SECRET, Math.floor(2000000000 / 30))).toBe('279037');
  });

  it('aceita o codigo do instante e recusa o de outro', () => {
    const at = new Date(1234567890 * 1000);

    expect(verifyCode(RFC_SECRET, '005924', { at }).ok).toBe(true);
    expect(verifyCode(RFC_SECRET, '279037', { at }).ok).toBe(false);
  });

  it('tolera um passo de atraso e recusa dois', () => {
    const at = new Date(1234567890 * 1000);
    const anterior = codeAt(RFC_SECRET, stepAt(at) - 1);
    const antigo = codeAt(RFC_SECRET, stepAt(at) - 2);

    expect(verifyCode(RFC_SECRET, anterior, { at }).ok).toBe(true);
    expect(verifyCode(RFC_SECRET, antigo, { at }).ok).toBe(false);
  });

  it('recusa o mesmo codigo duas vezes', () => {
    const at = new Date(1234567890 * 1000);
    const primeiro = verifyCode(RFC_SECRET, '005924', { at });

    expect(primeiro.ok).toBe(true);
    expect(
      verifyCode(RFC_SECRET, '005924', { at, lastStep: primeiro.step }).ok,
    ).toBe(false);
  });

  it('recusa codigo com tamanho errado, sem estourar', () => {
    expect(verifyCode(RFC_SECRET, '12345').ok).toBe(false);
    expect(verifyCode(RFC_SECRET, 'abcdef').ok).toBe(false);
    expect(verifyCode(RFC_SECRET, '').ok).toBe(false);
  });

  it('gera segredo base32 utilizavel', () => {
    const secret = generateSecret();

    expect(secret).toMatch(/^[A-Z2-7]+$/);
    expect(codeAt(secret, 1)).toHaveLength(6);
  });

  it('monta a URI que o aplicativo autenticador le', () => {
    const url = new URL(
      otpauthUrl({ secret: RFC_SECRET, email: 'a@b.com', issuer: 'sso.local' }),
    );

    expect(url.protocol).toBe('otpauth:');
    expect(url.host).toBe('totp');
    expect(decodeURIComponent(url.pathname)).toBe('/sso.local:a@b.com');
    expect(url.searchParams.get('issuer')).toBe('sso.local');
    expect(url.searchParams.get('digits')).toBe('6');
    expect(url.searchParams.get('period')).toBe('30');
  });

  it('gera codigo de recuperacao legivel e o normaliza', () => {
    const code = generateRecoveryCode();

    expect(code).toMatch(/^[0-9A-Z]{5}-[0-9A-Z]{5}$/);
    expect(normalizeRecoveryCode(code.toLowerCase())).toBe(
      code.replace('-', ''),
    );
  });
});
