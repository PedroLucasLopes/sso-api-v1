import { Module } from '@nestjs/common';
import { UserController } from './Controller/user.controller';
import { UserService } from './Service/user.service';
import { PrismaModule } from 'src/global/prisma/prisma.module';

@Module({
  imports: [PrismaModule],
  controllers: [UserController],
  providers: [UserService],
})
export class UserModule {}
