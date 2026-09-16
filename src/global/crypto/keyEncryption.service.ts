import { Injectable, InternalServerErrorException } from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import { SealedKey } from './dto/sealedKey.dto';
import { openParts, readKey, sealParts } from './aead';

/**
 * Envelope encryption das chaves privadas de assinatura em repouso.
 *
 * A chave mestra (KEK) vem de KEY_ENCRYPTION_KEY e nunca toca o banco.
 * O que fica no Postgres e apenas o ciphertext, o IV e o auth tag, entao
 * um dump do banco sozinho nao permite forjar token.
 */
@Injectable()
export class KeyEncryptionService {
  private readonly kek: Buffer;

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
      // Auth tag invalido: ou a KEK mudou, ou a linha foi adulterada.
      throw new InternalServerErrorException(
        'Falha ao decifrar a chave de assinatura. Verifique KEY_ENCRYPTION_KEY.',
      );
    }
  }
}
