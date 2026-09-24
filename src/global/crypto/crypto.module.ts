import { Global, Module } from '@nestjs/common';
import { ConfigModule } from '@nestjs/config';
import { KeyEncryptionService } from './keyEncryption.service';

@Global()
@Module({
  imports: [ConfigModule],
  providers: [KeyEncryptionService],
  exports: [KeyEncryptionService],
})
export class CryptoModule {}
