export class Jwk {
  kty: string;
  n: string;
  e: string;
  kid: string;
  use: 'sig';
  alg: string;
}

export class Jwks {
  keys: Jwk[];
}

export class ActiveSigningKey {
  kid: string;
  algorithm: string;
  privateKeyPem: string;
}
