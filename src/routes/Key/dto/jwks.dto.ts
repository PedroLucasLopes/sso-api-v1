/** Uma chave publica RSA no formato JWK (RFC 7517). */
export class Jwk {
  kty: string;
  /** Modulo RSA, base64url. */
  n: string;
  /** Expoente publico, base64url. */
  e: string;
  /** Casa com o header `kid` do JWT, para o RP saber qual chave usar. */
  kid: string;
  use: 'sig';
  alg: string;
}

/** Documento publicado em /.well-known/jwks.json (RFC 7517 secao 5). */
export class Jwks {
  keys: Jwk[];
}

/** Chave ativa carregada em memoria para assinar. Nunca sai do processo. */
export class ActiveSigningKey {
  kid: string;
  algorithm: string;
  privateKeyPem: string;
}
