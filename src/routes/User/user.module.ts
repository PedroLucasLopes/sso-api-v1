import { Module } from '@nestjs/common';
import { UserController } from './Controller/user.controller';
import { UserCredentialController } from './Controller/userCredential.controller';
import { UserService } from './Service/user.service';
import { PrismaModule } from 'src/global/prisma/prisma.module';
import { CryptoModule } from 'src/global/crypto/crypto.module';
import { CredentialService } from '../auth/Service/credential.service';

@Module({
  imports: [PrismaModule, CryptoModule],
  controllers: [UserController, UserCredentialController],
  providers: [UserService, CredentialService],
})
export class UserModule {}
