import { Injectable } from '@nestjs/common';
import { Health } from './global/dto/health.dto';

@Injectable()
export class AppService {
  health(): Health {
    return {
      status: 'ok',
      service: 'sso',
      uptime: Math.floor(process.uptime()),
    };
  }
}
