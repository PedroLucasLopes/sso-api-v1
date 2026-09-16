import { IsIn, IsNotEmpty, IsOptional, IsString } from 'class-validator';
import { CLIENT_ASSERTION_TYPE } from './token.dto';

/**
 * Corpo do endpoint que resolve papel em permissoes.
 *
 * Usa a mesma autenticacao de cliente do token endpoint: o mapa de rotas de
 * um projeto nao e informacao para qualquer um.
 */
export class ResolvePermissions {
  @IsString()
  @IsNotEmpty()
  role: string;

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

export class PermissionSet {
  role: string;
  /** Casa com a claim `perm` do access token. Chave de cache do cliente. */
  hash: string;
  permissions: Array<{ path: string; method: string }>;
}
