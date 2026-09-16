import { IsNotEmpty, IsOptional, IsString } from 'class-validator';

/**
 * ABNF do `code_challenge` e do `code_verifier` (RFC 7636 secao 4.1):
 * 43 a 128 caracteres do conjunto unreserved.
 */
export const PKCE_PATTERN = /^[A-Za-z0-9\-._~]{43,128}$/;

/**
 * Apenas `client_id` e `redirect_uri` sao validados aqui.
 *
 * A RFC 6749 secao 4.1.2.1 impoe uma ORDEM: enquanto client_id e redirect_uri
 * nao estiverem validados, o erro tem de ser exibido ao usuario; depois disso,
 * todo erro DEVE voltar para o cliente pela redirect_uri, com o `state`.
 *
 * Um ValidationPipe roda antes do servico e responderia 400 em JSON para
 * qualquer campo, quebrando essa ordem. Por isso o resto e declarado opcional
 * e conferido no AuthService, na sequencia correta.
 */
export class Authorize {
  @IsString()
  @IsNotEmpty()
  client_id: string;

  @IsString()
  @IsNotEmpty()
  redirect_uri: string;

  @IsString()
  @IsOptional()
  response_type?: string;

  @IsString()
  @IsOptional()
  code_challenge?: string;

  @IsString()
  @IsOptional()
  code_challenge_method?: string;

  /**
   * Opaco para o servidor. Serve ao cliente para casar resposta com
   * requisicao; a protecao contra CSRF vem do cookie de transacao, que
   * amarra o fluxo ao navegador (RFC 9700 secao 2.1).
   */
  @IsString()
  @IsOptional()
  state?: string;

  @IsString()
  @IsOptional()
  scope?: string;
}
