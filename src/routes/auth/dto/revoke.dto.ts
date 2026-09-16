import { IsIn, IsNotEmpty, IsOptional, IsString } from 'class-validator';
import { CLIENT_ASSERTION_TYPE } from './token.dto';

/**
 * Corpo do revocation endpoint (RFC 7009 secao 2.1).
 *
 * O cliente se autentica do mesmo jeito que no token endpoint: sem isso,
 * qualquer um que capturasse um refresh token poderia derrubar a sessao
 * alheia de proposito.
 */
export class Revoke {
  @IsString()
  @IsNotEmpty()
  token: string;

  /** Dica, nao obrigacao. O servidor procura de qualquer forma. */
  @IsString()
  @IsOptional()
  @IsIn(['access_token', 'refresh_token'])
  token_type_hint?: string;

  @IsString()
  @IsOptional()
  @IsNotEmpty()
  client_id?: string;

  @IsString()
  @IsOptional()
  @IsIn([CLIENT_ASSERTION_TYPE])
  client_assertion_type?: string;

  @IsString()
  @IsOptional()
  @IsNotEmpty()
  client_assertion?: string;
}
