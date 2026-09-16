import { Injectable, Logger } from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import { PassportStrategy } from '@nestjs/passport';
import { Profile, Strategy, VerifyCallback } from 'passport-google-oauth20';
import { PrismaService } from 'src/global/prisma/prisma.service';
import { GoogleUser } from '../dto/googleUser';
import { IdentityProviderException } from '../error/identityProvider.exception';

/**
 * Federacao com o Google. O SSO e, neste trecho, um cliente OAuth do Google.
 *
 * Nao ha auto-cadastro: o usuario precisa existir previamente, criado pelo
 * console administrativo. Isso e intencional, o SSO nao aceita qualquer conta
 * Google que apareca.
 *
 * As recusas saem como `IdentityProviderException`, com codigo. O guard as
 * transforma num redirect para a tela de login, que explica o motivo.
 */
@Injectable()
export class GoogleStrategy extends PassportStrategy(Strategy, 'google') {
  private readonly logger = new Logger(GoogleStrategy.name);

  constructor(
    private config: ConfigService,
    private prisma: PrismaService,
  ) {
    super({
      clientID: config.getOrThrow<string>('GOOGLE_CLIENT_ID'),
      clientSecret: config.getOrThrow<string>('GOOGLE_CLIENT_SECRET'),
      callbackURL: config.getOrThrow<string>('GOOGLE_CALLBACK_URL'),
      scope: ['email', 'profile'],
      // O state e injetado pelo GoogleAuthGuard e conferido no AuthService,
      // porque o armazenamento proprio do passport exige express-session.
      state: false,
    });
  }

  async validate(
    _accessToken: string,
    _refreshToken: string,
    profile: Profile,
    done: VerifyCallback,
  ): Promise<void> {
    const email = profile.emails?.[0]?.value;
    const googleId = profile.id;

    if (!email) {
      throw new IdentityProviderException(
        'provider_error',
        'perfil do Google sem e-mail',
      );
    }

    // Sem esta checagem, uma conta com e-mail nao verificado permitiria
    // assumir a identidade de qualquer usuario cadastrado por e-mail.
    const emailVerified = (profile as { _json?: { email_verified?: boolean } })
      ._json?.email_verified;

    if (emailVerified === false) {
      this.logger.warn(`login recusado: e-mail nao verificado (${email})`);
      throw new IdentityProviderException(
        'email_not_verified',
        'e-mail do Google nao verificado',
      );
    }

    const user = await this.prisma.user.findUnique({ where: { email } });

    if (!user) {
      this.logger.warn('login recusado: conta Google sem cadastro no SSO');
      throw new IdentityProviderException(
        'account_not_registered',
        'usuario nao cadastrado no SSO',
      );
    }

    // Primeiro login: fixa a identidade externa.
    if (!user.authId) {
      await this.prisma.user.update({
        where: { id: user.id },
        data: { authId: googleId },
      });
    } else if (user.authId !== googleId) {
      // O e-mail bate mas a conta Google e outra. Antes isso passava, porque
      // o authId so era conferido quando estava vazio.
      this.logger.warn(
        `login recusado: authId divergente para o usuario ${user.id}`,
      );
      throw new IdentityProviderException(
        'account_mismatch',
        'conta Google diferente da vinculada a este usuario',
      );
    }

    const googleUser: GoogleUser = {
      userId: user.id,
      email: user.email,
      name: user.name,
    };

    done(null, googleUser);
  }
}
