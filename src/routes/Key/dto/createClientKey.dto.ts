import {
  IsNotEmpty,
  IsOptional,
  IsString,
  IsUUID,
  Matches,
} from 'class-validator';

export class CreateClientKey {
  @IsUUID(4)
  @IsNotEmpty()
  projectId: string;

  /**
   * Chave publica do cliente em PEM (SPKI). O SSO nunca ve a privada, que e
   * o ponto de usar `private_key_jwt` em vez de client_secret.
   */
  @IsString()
  @IsNotEmpty()
  @Matches(/^-----BEGIN PUBLIC KEY-----[\s\S]+-----END PUBLIC KEY-----\s*$/, {
    message: 'publicKeyPem deve ser uma chave publica em PEM (SPKI)',
    context: { code: 'public_key_not_pem' },
  })
  publicKeyPem: string;

  /** ISO 8601. Ausente significa sem expiracao. */
  @IsString()
  @IsOptional()
  expiresAt?: string;
}
