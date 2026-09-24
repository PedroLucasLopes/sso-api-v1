import { Module } from '@nestjs/common';
import { PrismaModule } from 'src/global/prisma/prisma.module';
import { RouteController } from './Controller/route.controller';
import { RouteService } from './Service/route.service';

@Module({
  imports: [PrismaModule],
  controllers: [RouteController],
  providers: [RouteService],
})
export class RouteModule {}
