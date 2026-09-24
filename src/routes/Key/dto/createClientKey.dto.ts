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

  @IsString()
  @IsNotEmpty()
  @Matches(/^-----BEGIN PUBLIC KEY-----[\s\S]+-----END PUBLIC KEY-----\s*$/, {
    message: 'publicKeyPem deve ser uma chave publica em PEM (SPKI)',
    context: { code: 'public_key_not_pem' },
  })
  publicKeyPem: string;

  @IsString()
  @IsOptional()
  expiresAt?: string;
}
