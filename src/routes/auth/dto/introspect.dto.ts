import { IsIn, IsNotEmpty, IsOptional, IsString } from 'class-validator';
import { CLIENT_ASSERTION_TYPE } from './token.dto';

/**
 * Corpo do introspection endpoint (RFC 7662 secao 2.1).
 *
 * Quem pergunta e a aplicacao, autenticada do mesmo jeito que no token
 * endpoint. A secao 4 exige alguma autorizacao aqui: sem ela o endpoint vira
 * ferramenta para testar tokens capturados.
 */
export class Introspect {
  @IsString()
  @IsNotEmpty()
  token: string;

  /** Dica, nao obrigacao. So access token e introspectado. */
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

/**
 * Resposta do introspection endpoint (RFC 7662 secao 2.2).
 *
 * Inativo e so `{ "active": false }`, sem dizer por que: o motivo e assunto do
 * SSO, e contar se o token existia seria o oraculo que a secao 4 quer evitar.
 *
 * `sid`, `roles` e `perm` sao extensoes, que a secao 2.2 permite. `roles` e
 * `perm` sao o que da razao a este endpoint existir: o papel da pessoa e o
 * conjunto dele **agora**, lidos do banco, e nao o que ficou escrito no token
 * quando ele foi emitido.
 */
export interface IntrospectionResponse {
  active: boolean;
  client_id?: string;
  token_type?: 'Bearer';
  sub?: string;
  aud?: string;
  iss?: string;
  jti?: string;
  exp?: number;
  iat?: number;
  sid?: string;
  roles?: string[];
  perm?: string;
}
