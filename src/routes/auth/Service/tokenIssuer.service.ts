import { Injectable } from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import { JwtService } from '@nestjs/jwt';
import * as crypto from 'node:crypto';
import { SigningKeyService } from 'src/routes/Key/Service/signingKey.service';

export interface IssueAccessTokenParams {
  userId: string;
  clientId: string;
  email: string;
  name: string;
  /** Papel do usuario neste projeto. Vai no token como claim `roles`. */
  role: string;
  /** Impressao digital do conjunto de permissoes do papel. Ver `permissionHash`. */
  permissionHash: string;
  /**
   * Sessao do usuario com o SSO que originou este token.
   *
   * Vai como claim `sid`, que a RFC 9068 secao 2.2.1 prevê. E o que permite
   * revogar a partir do proprio access token: sem ela, um pedido de revoke
   * trazendo um access token nao teria como achar o grant correspondente, e a
   * RFC 7009 secao 2.1 ficaria por cumprir.
   */
  authSessionId: string;
}

export interface IssuedAccessToken {
  token: string;
  /** Segundos, como manda a RFC 6749 secao 5.1. */
  expiresIn: number;
  jti: string;
}

/**
 * Emissao do access token.
 *
 * Assinatura RS256 com a chave privada do AS. O header carrega o `kid`, que
 * e como o RP escolhe a chave certa no JWKS sem precisar de segredo algum.
 * E a diferenca em relacao ao HS256 anterior: antes qualquer RP que
 * verificava tambem conseguia emitir.
 */
@Injectable()
export class TokenIssuerService {
  /** Curto de proposito: RFC 9700 secao 2.3. A renovacao vem do refresh token. */
  private static readonly DEFAULT_TTL_SECONDS = 900;

  private readonly issuer: string;
  private readonly ttlSeconds: number;

  constructor(
    private jwt: JwtService,
    private signingKeys: SigningKeyService,
    config: ConfigService,
  ) {
    this.issuer = config.getOrThrow<string>('SSO_ISSUER').replace(/\/+$/, '');

    const configured = Number(
      config.get<string>(
        'ACCESS_TOKEN_TTL',
        String(TokenIssuerService.DEFAULT_TTL_SECONDS),
      ),
    );

    this.ttlSeconds =
      Number.isFinite(configured) && configured > 0
        ? configured
        : TokenIssuerService.DEFAULT_TTL_SECONDS;
  }

  async issue(params: IssueAccessTokenParams): Promise<IssuedAccessToken> {
    const key = await this.signingKeys.getActiveKey();
    const jti = crypto.randomUUID();

    // iss, aud, sub e jti vao pelas options: o jsonwebtoken recusa a chamada
    // se a mesma claim aparecer no payload e nas options ao mesmo tempo.
    const token = await this.jwt.signAsync(
      {
        email: params.email,
        name: params.name,
        clientId: params.clientId,
        // RFC 9068 secao 2.2.3.1: papel vai como `roles`, com o nome do
        // atributo do esquema User do SCIM (RFC 7643 secao 4.1.2).
        //
        // A lista enumerada de rotas NAO entra aqui. Ela crescia com o numero
        // de rotas do projeto: com 38 rotas o token passou de 3 KB e o cookie
        // de sessao estourou o limite de 4 KB do navegador. Com 200 rotas
        // estouraria tambem o limite de header de varios proxies.
        roles: [params.role],
        // O cliente resolve `roles` em permissoes e cacheia por este hash.
        // Mudou a permissao do papel, muda o hash, o cache cai sozinho.
        perm: params.permissionHash,
        // Ancora de revogacao. Ver `authSessionId` acima.
        sid: params.authSessionId,
      },
      {
        algorithm: 'RS256',
        privateKey: key.privateKeyPem,
        keyid: key.kid,
        issuer: this.issuer,
        audience: params.clientId,
        subject: params.userId,
        jwtid: jti,
        expiresIn: this.ttlSeconds,
      },
    );

    return { token, expiresIn: this.ttlSeconds, jti };
  }
}
