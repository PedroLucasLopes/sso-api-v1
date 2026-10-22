import { Injectable, Logger } from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import { createHash } from 'node:crypto';
import { PWNED_PASSWORDS } from './security.constant';

@Injectable()
export class PwnedPasswordsService {
  private readonly logger = new Logger(PwnedPasswordsService.name);
  private readonly enabled: boolean;

  constructor(config: ConfigService) {
    this.enabled =
      config.get<string>('PWNED_PASSWORDS_ENABLED', 'true').trim() !== 'false';
  }

  async isBreached(password: string): Promise<boolean> {
    if (!this.enabled) return false;

    const hash = createHash('sha1')
      .update(password, 'utf8')
      .digest('hex')
      .toUpperCase();
    const prefix = hash.slice(0, 5);
    const suffix = hash.slice(5);

    try {
      const response = await fetch(`${PWNED_PASSWORDS.rangeUrl}${prefix}`, {
        headers: {
          'Add-Padding': 'true',
          'User-Agent': PWNED_PASSWORDS.userAgent,
        },
        signal: AbortSignal.timeout(PWNED_PASSWORDS.timeoutMs),
      });

      if (!response.ok) {
        this.logger.warn(
          `Pwned Passwords respondeu ${response.status}; a senha segue sem a consulta de vazamentos`,
        );
        return false;
      }

      for (const line of (await response.text()).split('\n')) {
        const [candidate, count] = line.trim().split(':');

        if (candidate === suffix && Number(count) > 0) return true;
      }

      return false;
    } catch {
      this.logger.warn(
        'Pwned Passwords indisponivel; a senha segue sem a consulta de vazamentos',
      );
      return false;
    }
  }
}
