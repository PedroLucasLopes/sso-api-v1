export class AuthorizationServerMetadata {
  issuer: string;
  authorization_endpoint: string;
  token_endpoint: string;
  revocation_endpoint: string;
  revocation_endpoint_auth_methods_supported: string[];
  introspection_endpoint: string;
  introspection_endpoint_auth_methods_supported: string[];
  permissions_endpoint: string;
  jwks_uri: string;
  response_types_supported: string[];
  response_modes_supported: string[];
  authorization_response_iss_parameter_supported: boolean;
  grant_types_supported: string[];
  code_challenge_methods_supported: string[];
  token_endpoint_auth_methods_supported: string[];
  token_endpoint_auth_signing_alg_values_supported: string[];
}
