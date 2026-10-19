import { HttpException, HttpStatus } from '@nestjs/common';
import { Response } from 'express';

interface ApiErrorDefinition {
  status: HttpStatus;
  message: string;
}

export const API_ERRORS = {
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
  project_policy_root_only: {
    status: HttpStatus.FORBIDDEN,
    message: 'Only the root changes the sign-up and second factor policies',
  },
  default_role_required: {
    status: HttpStatus.BAD_REQUEST,
    message: 'Open sign-up and optional second factor need a default role',
  },
  role_is_default: {
    status: HttpStatus.BAD_REQUEST,
    message: 'The default role of a project cannot be deleted or moved',
  },
  logo_invalid: {
    status: HttpStatus.BAD_REQUEST,
    message: 'The logo must be a PNG, JPEG or WebP image as a base64 data URI',
  },
  logo_too_large: {
    status: HttpStatus.BAD_REQUEST,
    message: 'The logo is larger than the limit',
  },

  signup_closed: {
    status: HttpStatus.FORBIDDEN,
    message: 'This application does not accept new accounts',
  },
  email_unavailable: {
    status: HttpStatus.SERVICE_UNAVAILABLE,
    message: 'E-mail delivery is not configured',
  },
  human_check_required: {
    status: HttpStatus.FORBIDDEN,
    message: 'The human check token is missing',
  },
  human_check_failed: {
    status: HttpStatus.FORBIDDEN,
    message: 'The human check token was refused',
  },
  link_invalid: {
    status: HttpStatus.GONE,
    message: 'The link expired, was already used or does not exist',
  },
  json_required: {
    status: HttpStatus.UNSUPPORTED_MEDIA_TYPE,
    message: 'This route only accepts application/json',
  },

  invalid_credentials: {
    status: HttpStatus.UNAUTHORIZED,
    message: 'Email or password refused',
  },
  account_locked: {
    status: HttpStatus.TOO_MANY_REQUESTS,
    message: 'Too many failed attempts; try again later',
  },
  password_refused: {
    status: HttpStatus.BAD_REQUEST,
    message: 'The new password was refused',
  },
  password_not_issued: {
    status: HttpStatus.NOT_FOUND,
    message: 'This user has no password issued',
  },
  mfa_code_invalid: {
    status: HttpStatus.UNAUTHORIZED,
    message: 'Second factor code refused',
  },
  login_step_expired: {
    status: HttpStatus.GONE,
    message: 'The login step expired; start again',
  },
  no_pending_request: {
    status: HttpStatus.NOT_FOUND,
    message: 'No pending login request in this browser',
  },
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

  redirect_uri_not_found: {
    status: HttpStatus.NOT_FOUND,
    message: 'redirect URI nao encontrada',
  },

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

export type ApiErrorExtensions = Record<string, unknown>;

export function apiErrorBody(
  code: ApiErrorCode,
  extensions: ApiErrorExtensions = {},
): Record<string, unknown> {
  const { status, message } = API_ERRORS[code];

  return { ...extensions, statusCode: status, error: code, message };
}

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
