import { IsNotEmpty, IsOptional, IsString } from 'class-validator';

/**
 * `state` do console: 16 a 256 caracteres do conjunto unreserved. Curto demais
 * nao protege nada; sem teto, vira jeito de inflar o cookie de transacao.
 */
export const STATE_PATTERN = /^[A-Za-z0-9\-._~]{16,256}$/;

/**
 * Pedido de login do console. Mesma ordem do authorize (RFC 6749 secao
 * 4.1.2.1): o pipe so valida a `redirect_uri`, e o `state` e conferido no
 * servico, depois dela, para o erro poder voltar por ela.
 */
export class SessionLogin {
  @IsString()
  @IsNotEmpty()
  redirect_uri: string;

  @IsString()
  @IsOptional()
  state?: string;
}
