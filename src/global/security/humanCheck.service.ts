import { Injectable, Logger } from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import { BlockList, isIPv4, isIPv6 } from 'node:net';
import { ApiException } from '../error/apiError';
import {
  HumanCheckAction,
  IPV4_MAPPED_PREFIX,
  NON_PUBLIC_RANGES,
  TURNSTILE,
  TURNSTILE_CONFIG_ERRORS,
  TURNSTILE_TEST_KEY_PATTERN,
} from './security.constant';

export interface HumanCheckWidget {
  provider: 'turnstile';
  siteKey: string;
}

interface SiteverifyResponse {
  success?: boolean;
  hostname?: string;
  action?: string;
  'error-codes'?: string[];
  metadata?: { result_with_testing_key?: boolean };
}

const nonPublic = new BlockList();

for (const [address, prefix] of NON_PUBLIC_RANGES.ipv4) {
  nonPublic.addSubnet(address, prefix, 'ipv4');
}

for (const [address, prefix] of NON_PUBLIC_RANGES.ipv6) {
  nonPublic.addSubnet(address, prefix, 'ipv6');
}

export function isPublicAddress(raw: string): boolean {
  const ip =
    raw.startsWith(IPV4_MAPPED_PREFIX) &&
    isIPv4(raw.slice(IPV4_MAPPED_PREFIX.length))
      ? raw.slice(IPV4_MAPPED_PREFIX.length)
      : raw;

  if (isIPv4(ip)) return !nonPublic.check(ip, 'ipv4');
  if (isIPv6(ip)) return !nonPublic.check(ip, 'ipv6');

  return false;
}

@Injectable()
export class HumanCheckService {
  readonly widget: HumanCheckWidget | null;

  private readonly logger = new Logger(HumanCheckService.name);
  private readonly secretKey: string;
  private readonly hostnames: string[];
  private readonly allowTestKeys: boolean;
  private warnedAt = Number.NEGATIVE_INFINITY;

  constructor(config: ConfigService) {
    const enabled =
      config.get<string>('TURNSTILE_ENABLED', 'false').trim() === 'true';
    const siteKey = config.get<string>('TURNSTILE_SITE_KEY', '').trim();

    this.secretKey = config.get<string>('TURNSTILE_SECRET_KEY', '').trim();
    this.hostnames = config
      .get<string>('TURNSTILE_HOSTNAMES', '')
      .split(',')
      .map((host) => host.trim().toLowerCase())
      .filter(Boolean);
    this.allowTestKeys =
      config.get<string>('TURNSTILE_ALLOW_TEST_KEYS', 'false').trim() ===
      'true';

    if (!enabled) {
      this.widget = null;
      return;
    }

    if (!siteKey || !this.secretKey) {
      throw new Error(
        'TURNSTILE_ENABLED=true exige TURNSTILE_SITE_KEY e TURNSTILE_SECRET_KEY',
      );
    }

    const testKey = [siteKey, this.secretKey].some((key) =>
      TURNSTILE_TEST_KEY_PATTERN.test(key),
    );

    if (testKey && !this.allowTestKeys) {
      throw new Error(
        'chave de teste do Turnstile aceita qualquer token: use as do painel, ou TURNSTILE_ALLOW_TEST_KEYS=true so no desenvolvimento',
      );
    }

    this.widget = { provider: 'turnstile', siteKey };
  }

  async verify(
    token: string | undefined,
    action: HumanCheckAction,
    ip: string | undefined,
  ): Promise<void> {
    if (!this.widget) return;

    const response = token?.trim();

    if (!response) throw new ApiException('human_check_required');

    if (response.length > TURNSTILE.maxTokenLength) {
      throw new ApiException('human_check_failed');
    }

    const result = await this.siteverify(response, ip);

    if (!result) return;

    const testing = result.metadata?.result_with_testing_key === true;

    if (testing && !this.allowTestKeys) {
      this.logger.error(
        'resposta de chave de teste com TURNSTILE_ALLOW_TEST_KEYS desligado: confira as chaves',
      );
      throw new ApiException('human_check_failed');
    }

    if (result.success !== true) throw new ApiException('human_check_failed');

    if (testing) return;

    if (result.action !== action || !this.hostAllowed(result.hostname)) {
      throw new ApiException('human_check_failed');
    }
  }

  private async siteverify(
    response: string,
    ip: string | undefined,
  ): Promise<SiteverifyResponse | null> {
    const body: Record<string, string> = { secret: this.secretKey, response };

    if (ip && isPublicAddress(ip)) body.remoteip = ip;

    try {
      const reply = await fetch(TURNSTILE.verifyUrl, {
        method: 'POST',
        headers: { 'content-type': 'application/json' },
        body: JSON.stringify(body),
        signal: AbortSignal.timeout(TURNSTILE.timeoutMs),
      });

      if (reply.status >= 500) return this.unavailable(`HTTP ${reply.status}`);

      const result = (await reply.json()) as SiteverifyResponse;
      const codes = result['error-codes'] ?? [];

      if (codes.includes('internal-error')) {
        return this.unavailable('internal-error');
      }

      if (codes.some((code) => TURNSTILE_CONFIG_ERRORS.includes(code))) {
        this.logger.error(
          `a Cloudflare recusou a chave secreta do Turnstile (${codes.join(', ')})`,
        );
      }

      return result;
    } catch (error) {
      return this.unavailable((error as Error).name || 'erro de rede');
    }
  }

  private hostAllowed(hostname: string | undefined): boolean {
    if (this.hostnames.length === 0) return true;

    const host = hostname?.toLowerCase();

    return (
      !!host &&
      this.hostnames.some(
        (entry) => host === entry || host.endsWith(`.${entry}`),
      )
    );
  }

  private unavailable(reason: string): null {
    const now = Date.now();

    if (now - this.warnedAt >= TURNSTILE.warnEveryMs) {
      this.warnedAt = now;
      this.logger.warn(
        `Cloudflare sem resposta na conferencia (${reason}): seguindo sem a prova; as outras travas valem`,
      );
    }

    return null;
  }
}
