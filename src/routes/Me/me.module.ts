import { Module } from '@nestjs/common';
import { MeController } from './Controller/me.controller';

// AdminAccessService vem do AccessModule, que e @Global().
@Module({
  controllers: [MeController],
})
export class MeModule {}
