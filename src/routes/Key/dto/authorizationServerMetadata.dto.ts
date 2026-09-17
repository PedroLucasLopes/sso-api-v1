/**
 * Metadados do Authorization Server (RFC 8414 secao 2).
 *
 * Serve para o RP se autoconfigurar em vez de ter endpoint hardcoded, e e
 * de onde ele descobre o `jwks_uri` para verificar a assinatura do token.
 */
export class AuthorizationServerMetadata {
  issuer: string;
  authorization_endpoint: string;
  token_endpoint: string;
  /** RFC 7009 secao 5: anunciado junto dos demais. */
  revocation_endpoint: string;
  revocation_endpoint_auth_methods_supported: string[];
  /** Extensao propria, fora da RFC 8414. Resolve `roles` em permissoes. */
  permissions_endpoint: string;
  jwks_uri: string;
  response_types_supported: string[];
  response_modes_supported: string[];
  /** RFC 9207 secao 3: o `iss` vai em toda resposta de autorizacao. */
  authorization_response_iss_parameter_supported: boolean;
  grant_types_supported: string[];
  code_challenge_methods_supported: string[];
  token_endpoint_auth_methods_supported: string[];
  token_endpoint_auth_signing_alg_values_supported: string[];
}
