import { Module } from '@nestjs/common';
import { PrismaModule } from 'src/global/prisma/prisma.module';
import { ProjectUserController } from './Controller/projectUser.controller';
import { ProjectUserService } from './Service/projectUser.service';

@Module({
  imports: [PrismaModule],
  controllers: [ProjectUserController],
  providers: [ProjectUserService],
})
export class ProjectUserModule {}
