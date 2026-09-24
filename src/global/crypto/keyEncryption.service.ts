import { Injectable, Logger } from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import { SealedKey } from './dto/sealedKey.dto';
import {
  openCompact,
  openParts,
  readKey,
  sealCompact,
  sealParts,
} from './aead';
import { ApiException } from '../error/apiError';

@Injectable()
export class KeyEncryptionService {
  private readonly kek: Buffer;
  private readonly logger = new Logger(KeyEncryptionService.name);

  constructor(config: ConfigService) {
    this.kek = readKey(
      config.getOrThrow<string>('KEY_ENCRYPTION_KEY'),
      'KEY_ENCRYPTION_KEY',
    );
  }

  seal(plaintext: string): SealedKey {
    return sealParts(this.kek, plaintext);
  }

  open(sealed: SealedKey): string {
    try {
      return openParts(this.kek, sealed);
    } catch {
      this.logger.error(
        'Falha ao decifrar a chave de assinatura. Verifique KEY_ENCRYPTION_KEY.',
      );
      throw new ApiException('internal_error');
    }
  }

  sealToken(plaintext: string): string {
    return sealCompact(this.kek, plaintext);
  }

  openToken(token: string): string {
    const plaintext = openCompact(this.kek, token);

    if (plaintext === null) {
      this.logger.error(
        'Falha ao decifrar um segredo guardado. Verifique KEY_ENCRYPTION_KEY.',
      );
      throw new ApiException('internal_error');
    }

    return plaintext;
  }
}
