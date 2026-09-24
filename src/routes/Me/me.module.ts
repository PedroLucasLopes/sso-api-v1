import { Module } from '@nestjs/common';
import { MeController } from './Controller/me.controller';

@Module({
  controllers: [MeController],
})
export class MeModule {}
