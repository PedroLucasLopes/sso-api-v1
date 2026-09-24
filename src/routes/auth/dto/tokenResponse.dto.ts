export class TokenResponse {
  access_token: string;
  token_type: 'Bearer';
  expires_in: number;
  refresh_token: string;
  scope?: string;
}

export class AccessTokenClaims {
  iss: string;
  sub: string;
  aud: string;
  jti: string;
  email: string;
  name: string;
  clientId: string;
  roles: string[];
  perm: string;
}
