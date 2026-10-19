import type { ConfigService } from '@nestjs/config';
import { createHash } from 'node:crypto';
import { PwnedPasswordsService } from './pwnedPasswords.service';
import { PWNED_PASSWORDS } from './security.constant';

function config(values: Record<string, string> = {}): ConfigService {
  return {
    get: (key: string, fallback?: string) => values[key] ?? fallback,
  } as unknown as ConfigService;
}

function sha1(password: string): { prefix: string; suffix: string } {
  const hash = createHash('sha1').update(password).digest('hex').toUpperCase();

  return { prefix: hash.slice(0, 5), suffix: hash.slice(5) };
}

describe('Pwned Passwords', () => {
  const fetchSpy = jest.spyOn(global, 'fetch');

  afterEach(() => fetchSpy.mockReset());
  afterAll(() => fetchSpy.mockRestore());

  it('manda so os 5 primeiros caracteres do SHA-1, com padding', async () => {
    const { prefix, suffix } = sha1('Senha-Vazada-2020');

    fetchSpy.mockResolvedValue(new Response(`${suffix}:42\r\nABC:0`));

    expect(
      await new PwnedPasswordsService(config()).isBreached('Senha-Vazada-2020'),
    ).toBe(true);

    const [url, init] = fetchSpy.mock.calls[0];

    expect(url).toBe(`${PWNED_PASSWORDS.rangeUrl}${prefix}`);
    expect(url as string).not.toContain(suffix);
    expect((init?.headers as Record<string, string>)['Add-Padding']).toBe(
      'true',
    );
  });

  it('linha de padding com contagem zero nao conta como vazamento', async () => {
    const { suffix } = sha1('Senha-Inedita-2027');

    fetchSpy.mockResolvedValue(new Response(`${suffix}:0`));

    expect(
      await new PwnedPasswordsService(config()).isBreached(
        'Senha-Inedita-2027',
      ),
    ).toBe(false);
  });

  it('fora do ar, a senha segue sem a consulta', async () => {
    fetchSpy.mockRejectedValue(new TypeError('fetch failed'));

    expect(
      await new PwnedPasswordsService(config()).isBreached('Qualquer-2027'),
    ).toBe(false);
  });

  it('resposta de erro tambem deixa a senha seguir', async () => {
    fetchSpy.mockResolvedValue(new Response('', { status: 503 }));

    expect(
      await new PwnedPasswordsService(config()).isBreached('Qualquer-2027'),
    ).toBe(false);
  });

  it('desligado, nem consulta', async () => {
    const service = new PwnedPasswordsService(
      config({ PWNED_PASSWORDS_ENABLED: 'false' }),
    );

    expect(await service.isBreached('Qualquer-2027')).toBe(false);
    expect(fetchSpy).not.toHaveBeenCalled();
  });
});
