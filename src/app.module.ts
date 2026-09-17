import { Module } from '@nestjs/common';
import { ConfigModule } from '@nestjs/config';
import { APP_GUARD } from '@nestjs/core';
import { ThrottlerGuard, ThrottlerModule } from '@nestjs/throttler';

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
    /*
     * Limite de requisicoes por origem. Nao ha senha para adivinhar aqui, entao
     * o que ele protege e disponibilidade: uma origem sozinha nao ocupa o
     * servidor nem o banco. O teto e alto porque o console faz varias chamadas
     * por tela; as rotas caras do OAuth tem limite proprio, com `@Throttle`.
     *
     * A contagem e por processo, em memoria. Com mais de uma instancia, cada
     * uma conta a sua: e piso, nao teto exato, e quem precisar de numero exato
     * troca o storage. Atras de proxy, o IP so e o de quem pediu com
     * `TRUST_PROXY` ligado (ver `main.ts`).
     */
    ThrottlerModule.forRoot({
      throttlers: [{ name: 'default', ttl: 60_000, limit: 600 }],
    }),
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
    // Antes do guard de acesso: enxurrada sem credencial nenhuma para no
    // limite, sem chegar a consultar o banco.
    {
      provide: APP_GUARD,
      useClass: ThrottlerGuard,
    },
    {
      provide: APP_GUARD,
      useClass: SSOAdminGuard,
    },
  ],
})
export class AppModule {}
