import { Global, Module } from '@nestjs/common';
import { ConfigModule } from '@nestjs/config';
import { HumanCheckGuard } from './humanCheck.guard';
import { HumanCheckService } from './humanCheck.service';
import { PwnedPasswordsService } from './pwnedPasswords.service';
import { SameOriginGuard } from './sameOrigin.guard';

@Global()
@Module({
  imports: [ConfigModule],
  providers: [
    HumanCheckService,
    HumanCheckGuard,
    PwnedPasswordsService,
    SameOriginGuard,
  ],
  exports: [
    HumanCheckService,
    HumanCheckGuard,
    PwnedPasswordsService,
    SameOriginGuard,
  ],
})
export class SecurityModule {}
