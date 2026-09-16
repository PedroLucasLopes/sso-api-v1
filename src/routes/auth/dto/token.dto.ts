import {
  IsIn,
  IsNotEmpty,
  IsOptional,
  IsString,
  Matches,
} from 'class-validator';
import { PKCE_PATTERN } from './authorize.dto';

export const CLIENT_ASSERTION_TYPE =
  'urn:ietf:params:oauth:client-assertion-type:jwt-bearer';

/**
 * Corpo do token endpoint. Um DTO so para os dois grants, porque o
 * ValidationPipe global roda com `forbidNonWhitelisted` e recusaria campo
 * declarado em outra classe. A checagem de quais campos sao obrigatorios em
 * cada grant fica no AuthService.
 */
export class Token {
  @IsString()
  @IsIn(['authorization_code', 'refresh_token'])
  grant_type: 'authorization_code' | 'refresh_token';

  // ---- grant_type=authorization_code ----

  @IsString()
  @IsOptional()
  @IsNotEmpty()
  code?: string;

  @IsString()
  @IsOptional()
  @Matches(PKCE_PATTERN, {
    message:
      'code_verifier deve ter de 43 a 128 caracteres do conjunto unreserved',
  })
  code_verifier?: string;

  @IsString()
  @IsOptional()
  @IsNotEmpty()
  redirect_uri?: string;

  // ---- grant_type=refresh_token ----

  @IsString()
  @IsOptional()
  @IsNotEmpty()
  refresh_token?: string;

  // ---- autenticacao do cliente (RFC 7523 secao 2.2) ----

  /**
   * Redundante com o `iss`/`sub` da asserção, mas a RFC 6749 secao 4.1.3
   * pede o campo e ele ajuda a localizar as chaves antes de verificar.
   */
  @IsString()
  @IsOptional()
  @IsNotEmpty()
  client_id?: string;

  @IsString()
  @IsOptional()
  @IsIn([CLIENT_ASSERTION_TYPE])
  client_assertion_type?: string;

  /** JWT assinado com a chave privada do cliente. */
  @IsString()
  @IsOptional()
  @IsNotEmpty()
  client_assertion?: string;
}
