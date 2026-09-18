import { HttpException, HttpStatus } from '@nestjs/common';
import { Response } from 'express';

interface ApiErrorDefinition {
  status: HttpStatus;
  message: string;
}

/**
 * O contrato de erro da API administrativa. Todo erro sai com um codigo estavel
 * no campo `error`, e e por ele que o console escolhe o texto, na lingua da tela:
 *
 *   { "statusCode": 404, "error": "project_not_found", "message": "projeto nao encontrado" }
 *
 * - **`error` e o contrato.** Codigo novo e acrescimo; renomear ou tirar um
 *   quebra o front que o traduz.
 * - **`message` e para quem le a resposta crua**, como o `detail` da RFC 9457
 *   secao 3.1.4. Nenhum front a mostra, e ela nunca carrega valor vindo da
 *   requisicao nem detalhe interno.
 * - **Valor que a tela precisa mostrar vai num membro proprio** (RFC 9457
 *   secao 3.2), nunca dentro do texto.
 *
 * Fora deste catalogo, e ja no mesmo formato: as recusas da protecao do projeto
 * `SSO` (`selfProjectProtection.ts`), as da redirect URI do console, as do
 * anti-CSRF e da origem, e o `no_pending_request` da tela de login. O OAuth tem
 * o formato da RFC 6749, com os codigos dela, em `routes/auth/error`.
 */
export const API_ERRORS = {
  // gerais
  no_results: {
    status: HttpStatus.NOT_FOUND,
    message: 'nenhum registro encontrado',
  },
  validation_failed: {
    status: HttpStatus.BAD_REQUEST,
    message: 'os valores enviados foram recusados',
  },
  duplicate: {
    status: HttpStatus.CONFLICT,
    message: 'ja existe um registro com estes valores',
  },
  internal_error: {
    status: HttpStatus.INTERNAL_SERVER_ERROR,
    message: 'erro interno',
  },

  // quem chama
  login_required: {
    status: HttpStatus.UNAUTHORIZED,
    message: 'sem sessao nem access token',
  },
  invalid_token: {
    status: HttpStatus.UNAUTHORIZED,
    message: 'access token invalido, expirado ou de outra aplicacao',
  },
  sso_access_denied: {
    status: HttpStatus.FORBIDDEN,
    message: 'a conta nao tem papel no projeto SSO',
  },

  // projeto
  project_not_found: {
    status: HttpStatus.NOT_FOUND,
    message: 'projeto nao encontrado',
  },
  client_key_required: {
    status: HttpStatus.BAD_REQUEST,
    message: 'cadastre ao menos uma chave publica antes de ativar o projeto',
  },
  project_has_members: {
    status: HttpStatus.BAD_REQUEST,
    message: 'o projeto tem membros',
  },
  project_has_routes: {
    status: HttpStatus.BAD_REQUEST,
    message: 'o projeto tem rotas',
  },

  // usuario e membro
  user_not_found: {
    status: HttpStatus.NOT_FOUND,
    message: 'usuario nao encontrado',
  },
  user_has_projects: {
    status: HttpStatus.BAD_REQUEST,
    message: 'o usuario ainda e membro de algum projeto',
  },
  member_not_found: {
    status: HttpStatus.NOT_FOUND,
    message: 'a pessoa nao e membro deste projeto',
  },

  // papel, rota e permissao
  role_not_found: {
    status: HttpStatus.NOT_FOUND,
    message: 'papel nao encontrado',
  },
  role_not_in_project: {
    status: HttpStatus.BAD_REQUEST,
    message: 'o papel nao pertence a este projeto',
  },
  route_not_found: {
    status: HttpStatus.NOT_FOUND,
    message: 'rota nao encontrada',
  },
  permission_not_found: {
    status: HttpStatus.NOT_FOUND,
    message: 'permissao nao encontrada',
  },
  role_route_project_mismatch: {
    status: HttpStatus.BAD_REQUEST,
    message: 'papel e rota sao de projetos diferentes',
  },

  // redirect URI
  redirect_uri_not_found: {
    status: HttpStatus.NOT_FOUND,
    message: 'redirect URI nao encontrada',
  },

  // chave de cliente
  client_key_not_found: {
    status: HttpStatus.NOT_FOUND,
    message: 'chave nao encontrada ou ja revogada',
  },
  client_keys_empty: {
    status: HttpStatus.NOT_FOUND,
    message: 'nenhuma chave cadastrada para este projeto',
  },
  public_key_invalid: {
    status: HttpStatus.BAD_REQUEST,
    message: 'publicKeyPem nao e uma chave valida',
  },
  public_key_not_rsa: {
    status: HttpStatus.BAD_REQUEST,
    message: 'apenas chaves RSA sao aceitas (RS256)',
  },
  public_key_too_short: {
    status: HttpStatus.BAD_REQUEST,
    message: 'a chave RSA precisa ter ao menos 2048 bits',
  },
} as const satisfies Record<string, ApiErrorDefinition>;

export type ApiErrorCode = keyof typeof API_ERRORS;

/**
 * Membros extras do corpo, com o que a tela precisa para montar o texto. So
 * valor seguro de mostrar: nada de detalhe interno.
 */
export type ApiErrorExtensions = Record<string, unknown>;

/** O corpo do erro. Os membros fixos vencem qualquer extensao de mesmo nome. */
export function apiErrorBody(
  code: ApiErrorCode,
  extensions: ApiErrorExtensions = {},
): Record<string, unknown> {
  const { status, message } = API_ERRORS[code];

  return { ...extensions, statusCode: status, error: code, message };
}

/** Para filtros, que escrevem a resposta sem passar por exception. */
export function sendApiError(
  response: Response,
  code: ApiErrorCode,
  extensions?: ApiErrorExtensions,
): void {
  response.status(API_ERRORS[code].status).json(apiErrorBody(code, extensions));
}

export class ApiException extends HttpException {
  constructor(
    readonly code: ApiErrorCode,
    extensions?: ApiErrorExtensions,
  ) {
    super(apiErrorBody(code, extensions), API_ERRORS[code].status);
  }
}
