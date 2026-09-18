import { Controller, Get, Header, HttpCode, HttpStatus } from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import { Public } from 'src/global/decorator/public.decorator';
import { SigningKeyService } from '../Service/signingKey.service';
import { Jwks } from '../dto/jwks.dto';
import { AuthorizationServerMetadata } from '../dto/authorizationServerMetadata.dto';

@Controller('.well-known')
@Public()
export class WellKnownController {
  private readonly issuer: string;

  constructor(
    private signingKeyService: SigningKeyService,
    config: ConfigService,
  ) {
    // Sem barra no fim: e prefixo de URL e tambem a claim `iss` do token.
    this.issuer = config.getOrThrow<string>('SSO_ISSUER').replace(/\/+$/, '');
  }

  /**
   * Chaves publicas de assinatura (RFC 7517 secao 5).
   * Cacheavel: o RP guarda o documento e so rebusca quando ve um `kid` novo.
   */
  @Get('jwks.json')
  @HttpCode(HttpStatus.OK)
  @Header('Cache-Control', 'public, max-age=300, must-revalidate')
  async jwks(): Promise<Jwks> {
    return this.signingKeyService.getJwks();
  }

  @Get('oauth-authorization-server')
  @HttpCode(HttpStatus.OK)
  @Header('Cache-Control', 'public, max-age=300')
  metadata(): AuthorizationServerMetadata {
    return {
      issuer: this.issuer,
      authorization_endpoint: `${this.issuer}/oauth/authorize`,
      token_endpoint: `${this.issuer}/oauth/token`,
      revocation_endpoint: `${this.issuer}/oauth/revoke`,
      revocation_endpoint_auth_methods_supported: ['private_key_jwt'],
      // RFC 8414 secao 2: anunciado aqui, a aplicacao descobre o endpoint em
      // vez de fixar a URL. O `sso-client` so introspecta quando o encontra.
      introspection_endpoint: `${this.issuer}/oauth/introspect`,
      introspection_endpoint_auth_methods_supported: ['private_key_jwt'],
      // Extensao propria: resolve a claim `roles` do token no conjunto de
      // rotas que o papel libera. Nao e da RFC 8414, mas anunciar aqui evita
      // URL fixa espalhada por aplicacao.
      permissions_endpoint: `${this.issuer}/oauth/permissions`,
      jwks_uri: `${this.issuer}/.well-known/jwks.json`,
      response_types_supported: ['code'],
      response_modes_supported: ['query'],
      // RFC 9207 secao 2.3: quem publica estes metadados e manda `iss` na
      // resposta de autorizacao TEM de anunciar. Sem o anuncio, a secao 2.4
      // recomenda ao cliente descartar resposta com `iss` deste servidor.
      authorization_response_iss_parameter_supported: true,
      // Reflete o que o token endpoint aceita hoje, rotacao de refresh token
      // incluida.
      grant_types_supported: ['authorization_code', 'refresh_token'],
      // Só S256. `plain` e recusado de proposito (RFC 7636 secao 4.2).
      code_challenge_methods_supported: ['S256'],
      token_endpoint_auth_methods_supported: ['private_key_jwt'],
      token_endpoint_auth_signing_alg_values_supported: ['RS256'],
    };
  }
}
