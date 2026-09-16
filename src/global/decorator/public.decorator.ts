import { SetMetadata } from '@nestjs/common';
import {
  SSO_LEVEL_AUTHENTICATED,
  SSO_LEVEL_PUBLIC,
} from '../constants/ssoLevel.constant';

/** Sem identidade nenhuma: health, JWKS, discovery e os endpoints OAuth. */
export const Public = () => SetMetadata(SSO_LEVEL_PUBLIC, true);

/**
 * Exige credencial valida do projeto do proprio SSO, Bearer ou sessao do
 * console, mas nao consulta a tabela de permissoes. Use so onde a resposta ja
 * e limitada ao proprio usuario; qualquer coisa que leia ou escreva dado de
 * terceiro deve ficar sem decorator, para passar pelo RBAC.
 */
export const Authenticated = () => SetMetadata(SSO_LEVEL_AUTHENTICATED, true);
