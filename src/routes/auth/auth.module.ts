import { Module } from '@nestjs/common';
import { ConfigModule } from '@nestjs/config';
import { JwtModule } from '@nestjs/jwt';
import { PassportModule } from '@nestjs/passport';
import { PrismaModule } from 'src/global/prisma/prisma.module';
import { KeyModule } from '../Key/key.module';
import { AuthController } from './Controller/auth.controller';
import { LoginController } from './Controller/login.controller';
import { SessionController } from './Controller/session.controller';
import { AuthService } from './Service/auth.service';
import { AuthSessionService } from './Service/authSession.service';
import { AuthorizationCodeService } from './Service/authorizationCode.service';
import { ClientAuthService } from './Service/clientAuth.service';
import { LoginPageService } from './Service/loginPage.service';
import { PermissionSetService } from './Service/permissionSet.service';
import { RefreshTokenService } from './Service/refreshToken.service';
import { TokenIssuerService } from './Service/tokenIssuer.service';
import { GoogleStrategy } from './strategy/google.strategy';

@Module({
  imports: [
    PrismaModule,
    PassportModule,
    JwtModule.register({}),
    KeyModule,
    ConfigModule,
  ],
  controllers: [AuthController, SessionController, LoginController],
  providers: [
    AuthService,
    AuthSessionService,
    AuthorizationCodeService,
    PermissionSetService,
    RefreshTokenService,
    TokenIssuerService,
    ClientAuthService,
    LoginPageService,
    GoogleStrategy,
  ],
  exports: [AuthSessionService, RefreshTokenService],
})
export class AuthModule {}
