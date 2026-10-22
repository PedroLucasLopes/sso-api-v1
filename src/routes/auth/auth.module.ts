import { Module } from '@nestjs/common';
import { ConfigModule } from '@nestjs/config';
import { JwtModule } from '@nestjs/jwt';
import { PassportModule } from '@nestjs/passport';
import { PrismaModule } from 'src/global/prisma/prisma.module';
import { KeyModule } from '../Key/key.module';
import { AccountController } from './Controller/account.controller';
import { AccountProfileController } from './Controller/accountProfile.controller';
import { AuthController } from './Controller/auth.controller';
import { LoginController } from './Controller/login.controller';
import { SessionController } from './Controller/session.controller';
import { AccountService } from './Service/account.service';
import { AccountDeletionService } from './Service/accountDeletion.service';
import { AccountEmailService } from './Service/accountEmail.service';
import { AccountProfileService } from './Service/accountProfile.service';
import { DeletedAccountService } from './Service/deletedAccount.service';
import { MaintenanceService } from './Service/maintenance.service';
import { AuthService } from './Service/auth.service';
import { AuthSessionService } from './Service/authSession.service';
import { AuthorizationCodeService } from './Service/authorizationCode.service';
import { ClientAuthService } from './Service/clientAuth.service';
import { CredentialService } from './Service/credential.service';
import { LoginFlowService } from './Service/loginFlow.service';
import { LoginPageService } from './Service/loginPage.service';
import { LoginStepService } from './Service/loginStep.service';
import { PermissionSetService } from './Service/permissionSet.service';
import { ProjectEntryService } from './Service/projectEntry.service';
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
  controllers: [
    AuthController,
    SessionController,
    LoginController,
    AccountController,
    AccountProfileController,
  ],
  providers: [
    AuthService,
    AuthSessionService,
    AuthorizationCodeService,
    PermissionSetService,
    RefreshTokenService,
    TokenIssuerService,
    ClientAuthService,
    LoginPageService,
    LoginStepService,
    LoginFlowService,
    CredentialService,
    ProjectEntryService,
    AccountEmailService,
    AccountService,
    AccountProfileService,
    AccountDeletionService,
    DeletedAccountService,
    MaintenanceService,
    GoogleStrategy,
  ],
  exports: [AuthSessionService, RefreshTokenService, CredentialService],
})
export class AuthModule {}
