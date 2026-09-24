import { Module } from '@nestjs/common';
import { PrismaModule } from 'src/global/prisma/prisma.module';
import { PermissionController } from './Controller/permission.controller';
import { PermissionService } from './Service/permission.service';

@Module({
  imports: [PrismaModule],
  controllers: [PermissionController],
  providers: [PermissionService],
})
export class PermissionModule {}
