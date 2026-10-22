import type { ConfigService } from '@nestjs/config';
import { ApiException } from '../error/apiError';
import { HumanCheckService, isPublicAddress } from './humanCheck.service';

const REAL = {
  TURNSTILE_ENABLED: 'true',
  TURNSTILE_SITE_KEY: '0x4AAAAAAAreal-site',
  TURNSTILE_SECRET_KEY: '0x4AAAAAAAreal-secret',
  TURNSTILE_HOSTNAMES: 'sso.exemplo.com',
};

const TEST_KEYS = {
  TURNSTILE_ENABLED: 'true',
  TURNSTILE_SITE_KEY: '1x00000000000000000000AA',
  TURNSTILE_SECRET_KEY: '1x0000000000000000000000000000000AA',
};

function config(values: Record<string, string>): ConfigService {
  return {
    get: (key: string, fallback?: string) => values[key] ?? fallback,
  } as unknown as ConfigService;
}

async function refusal(check: Promise<void>): Promise<string | undefined> {
  try {
    await check;
    return undefined;
  } catch (error) {
    if (!(error instanceof ApiException)) throw error;

    return error.code;
  }
}

const reply = (body: unknown, status = 200) =>
  new Response(JSON.stringify(body), { status });

describe('prova de que e uma pessoa (Turnstile)', () => {
  const fetchSpy = jest.spyOn(global, 'fetch');

  afterEach(() => fetchSpy.mockReset());
  afterAll(() => fetchSpy.mockRestore());

  it('desligado, nao pede nada', async () => {
    const check = new HumanCheckService(config({}));

    expect(check.widget).toBeNull();
    expect(await refusal(check.verify(undefined, 'signup', '8.8.8.8'))).toBe(
      undefined,
    );
    expect(fetchSpy).not.toHaveBeenCalled();
  });

  it('ligado sem as chaves, o SSO nao sobe', () => {
    expect(
      () => new HumanCheckService(config({ TURNSTILE_ENABLED: 'true' })),
    ).toThrow();
  });

  it('chave de teste so sobe com TURNSTILE_ALLOW_TEST_KEYS', () => {
    expect(() => new HumanCheckService(config(TEST_KEYS))).toThrow();
    expect(
      new HumanCheckService(
        config({ ...TEST_KEYS, TURNSTILE_ALLOW_TEST_KEYS: 'true' }),
      ).widget,
    ).toEqual({ provider: 'turnstile', siteKey: TEST_KEYS.TURNSTILE_SITE_KEY });
  });

  it('sem token, human_check_required', async () => {
    const check = new HumanCheckService(config(REAL));

    expect(await refusal(check.verify('  ', 'signup', '8.8.8.8'))).toBe(
      'human_check_required',
    );
  });

  it('aceita o token da acao e do site certos', async () => {
    fetchSpy.mockResolvedValue(
      reply({ success: true, action: 'signup', hostname: 'sso.exemplo.com' }),
    );

    const check = new HumanCheckService(config(REAL));

    expect(await refusal(check.verify('token', 'signup', '8.8.8.8'))).toBe(
      undefined,
    );

    const body = JSON.parse(fetchSpy.mock.calls[0][1]?.body as string) as {
      remoteip?: string;
    };

    expect(body.remoteip).toBe('8.8.8.8');
  });

  it('recusa token de outro formulario ou de outro site', async () => {
    const check = new HumanCheckService(config(REAL));

    fetchSpy.mockResolvedValueOnce(
      reply({
        success: true,
        action: 'password_reset',
        hostname: 'sso.exemplo.com',
      }),
    );
    expect(await refusal(check.verify('token', 'signup', undefined))).toBe(
      'human_check_failed',
    );

    fetchSpy.mockResolvedValueOnce(
      reply({ success: true, action: 'signup', hostname: 'evil.exemplo.net' }),
    );
    expect(await refusal(check.verify('token', 'signup', undefined))).toBe(
      'human_check_failed',
    );
  });

  it('recusa token que a Cloudflare recusou', async () => {
    fetchSpy.mockResolvedValue(
      reply({ success: false, 'error-codes': ['timeout-or-duplicate'] }),
    );

    expect(
      await refusal(
        new HumanCheckService(config(REAL)).verify(
          'token',
          'signup',
          undefined,
        ),
      ),
    ).toBe('human_check_failed');
  });

  it('com a Cloudflare fora do ar, o pedido segue', async () => {
    fetchSpy.mockResolvedValueOnce(reply({}, 502));

    const check = new HumanCheckService(config(REAL));

    expect(await refusal(check.verify('token', 'signup', undefined))).toBe(
      undefined,
    );

    fetchSpy.mockRejectedValueOnce(new TypeError('fetch failed'));

    expect(await refusal(check.verify('token', 'signup', undefined))).toBe(
      undefined,
    );
  });

  it('resposta de chave de teste so vale com TURNSTILE_ALLOW_TEST_KEYS', async () => {
    fetchSpy.mockResolvedValue(
      reply({ success: true, metadata: { result_with_testing_key: true } }),
    );

    expect(
      await refusal(
        new HumanCheckService(config(REAL)).verify(
          'token',
          'signup',
          undefined,
        ),
      ),
    ).toBe('human_check_failed');

    expect(
      await refusal(
        new HumanCheckService(
          config({ ...TEST_KEYS, TURNSTILE_ALLOW_TEST_KEYS: 'true' }),
        ).verify('token', 'signup', undefined),
      ),
    ).toBe(undefined);
  });

  it('IP da rede local nao vai para a Cloudflare', () => {
    expect(isPublicAddress('172.18.0.1')).toBe(false);
    expect(isPublicAddress('::ffff:127.0.0.1')).toBe(false);
    expect(isPublicAddress('200.160.2.3')).toBe(true);
  });
});
