import { Module } from '@nestjs/common';
import { PrismaModule } from 'src/global/prisma/prisma.module';
import { RedirectUriService } from './Service/redirectUri.service';
import { RedirectUriController } from './Controller/redirectUri.controller';

@Module({
  imports: [PrismaModule],
  controllers: [RedirectUriController],
  providers: [RedirectUriService],
})
export class RedirectUriModule {}
