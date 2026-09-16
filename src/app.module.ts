import { Module } from '@nestjs/common';
import { ConfigModule } from '@nestjs/config';
import { APP_GUARD } from '@nestjs/core';

import { AppController } from './app.controller';
import { AppService } from './app.service';

import { AccessModule } from './global/access/access.module';
import { CookieModule } from './global/cookie/cookie.module';
import { CryptoModule } from './global/crypto/crypto.module';
import { SSOAdminGuard } from './global/guards/ssoadminguard.guard';
import { PrismaModule } from './global/prisma/prisma.module';

import { AuthModule } from './routes/auth/auth.module';
import { KeyModule } from './routes/Key/key.module';
import { MeModule } from './routes/Me/me.module';
import { PermissionModule } from './routes/Permission/permission.module';
import { ProjectModule } from './routes/Project/project.module';
import { ProjectUserModule } from './routes/ProjectUser/projectUser.module';
import { RedirectUriModule } from './routes/redirectUri/redirectUri.module';
import { RoleModule } from './routes/Role/role.module';
import { RouteModule } from './routes/Route/route.module';
import { UserModule } from './routes/User/user.module';

// Sem RedisModule: o estado de transacao e a sessao vivem em cookie cifrado,
// e authorization code e refresh token vivem no Postgres, onde o uso unico e
// a deteccao de reuso podem ser atomicos.
@Module({
  imports: [
    ConfigModule,
    PrismaModule,
    AccessModule,
    CryptoModule,
    CookieModule,
    KeyModule,
    MeModule,
    UserModule,
    ProjectModule,
    RouteModule,
    RoleModule,
    RedirectUriModule,
    PermissionModule,
    ProjectUserModule,
    AuthModule,
  ],
  controllers: [AppController],
  providers: [
    AppService,
    {
      provide: APP_GUARD,
      useClass: SSOAdminGuard,
    },
  ],
})
export class AppModule {}
