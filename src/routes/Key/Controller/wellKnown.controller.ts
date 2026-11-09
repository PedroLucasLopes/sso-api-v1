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
    this.issuer = config.getOrThrow<string>('SSO_ISSUER').replace(/\/+$/, '');
  }

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
      introspection_endpoint: `${this.issuer}/oauth/introspect`,
      introspection_endpoint_auth_methods_supported: ['private_key_jwt'],
      permissions_endpoint: `${this.issuer}/oauth/permissions`,
      jwks_uri: `${this.issuer}/.well-known/jwks.json`,
      response_types_supported: ['code'],
      response_modes_supported: ['query'],
      authorization_response_iss_parameter_supported: true,
      grant_types_supported: ['authorization_code', 'refresh_token'],
      code_challenge_methods_supported: ['S256'],
      token_endpoint_auth_methods_supported: ['private_key_jwt'],
      token_endpoint_auth_signing_alg_values_supported: ['RS256'],
    };
  }
}
