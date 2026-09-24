import { Module } from '@nestjs/common';
import { ProjectService } from './Service/project.service';
import { PrismaModule } from 'src/global/prisma/prisma.module';
import { ProjectController } from './Controller/project.controller';

@Module({
  imports: [PrismaModule],
  controllers: [ProjectController],
  providers: [ProjectService],
})
export class ProjectModule {}
