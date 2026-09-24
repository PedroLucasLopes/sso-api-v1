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
  role: string;
  permissionHash: string;
  authSessionId: string;
}

export interface IssuedAccessToken {
  token: string;
  expiresIn: number;
  jti: string;
}

@Injectable()
export class TokenIssuerService {
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

    const token = await this.jwt.signAsync(
      {
        email: params.email,
        name: params.name,
        clientId: params.clientId,
        roles: [params.role],
        perm: params.permissionHash,
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
