import { Injectable, Logger } from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import { PassportStrategy } from '@nestjs/passport';
import { Profile, Strategy, VerifyCallback } from 'passport-google-oauth20';
import { PrismaService } from 'src/global/prisma/prisma.service';
import { GoogleUser } from '../dto/googleUser';
import { IdentityProviderException } from '../error/identityProvider.exception';

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

    if (!user.authId) {
      await this.prisma.user.update({
        where: { id: user.id },
        data: { authId: googleId },
      });
    } else if (user.authId !== googleId) {
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
