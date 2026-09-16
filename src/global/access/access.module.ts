import { Global, Module } from '@nestjs/common';
import { ConfigModule } from '@nestjs/config';
import { DiscoveryModule } from '@nestjs/core';
import { PrismaModule } from '../prisma/prisma.module';
import { AdminAccessService } from './adminAccess.service';
import { AdminRoutesService } from './adminRoutes.service';

/**
 * Global porque o SSOAdminGuard e APP_GUARD e roda antes de qualquer modulo
 * de dominio. Nao importa nenhum modulo de rota, entao nao ha ciclo com os
 * controllers que ele protege.
 */
@Global()
@Module({
  imports: [ConfigModule, PrismaModule, DiscoveryModule],
  providers: [AdminAccessService, AdminRoutesService],
  exports: [AdminAccessService],
})
export class AccessModule {}
