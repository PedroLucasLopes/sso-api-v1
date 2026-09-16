import { Module } from '@nestjs/common';
import { ConfigModule } from '@nestjs/config';
import { PrismaModule } from 'src/global/prisma/prisma.module';
import { ClientKeyController } from './Controller/clientKey.controller';
import { WellKnownController } from './Controller/wellKnown.controller';
import { ClientKeyService } from './Service/clientKey.service';
import { SigningKeyService } from './Service/signingKey.service';

@Module({
  imports: [PrismaModule, ConfigModule],
  controllers: [WellKnownController, ClientKeyController],
  providers: [SigningKeyService, ClientKeyService],
  exports: [SigningKeyService],
})
export class KeyModule {}
