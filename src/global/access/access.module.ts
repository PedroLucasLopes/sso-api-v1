import { Global, Module } from '@nestjs/common';
import { ConfigModule } from '@nestjs/config';
import { DiscoveryModule } from '@nestjs/core';
import { PrismaModule } from '../prisma/prisma.module';
import { AdminAccessService } from './adminAccess.service';
import { AdminRoutesService } from './adminRoutes.service';

@Global()
@Module({
  imports: [ConfigModule, PrismaModule, DiscoveryModule],
  providers: [AdminAccessService, AdminRoutesService],
  exports: [AdminAccessService],
})
export class AccessModule {}
