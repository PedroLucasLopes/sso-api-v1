import { NestFactory } from '@nestjs/core';
import { AppModule } from './app.module';
import { ValidationPipe } from '@nestjs/common';
import { NestExpressApplication } from '@nestjs/platform-express';
import helmet from 'helmet';
import { PrismaExceptionFilter } from './global/error/prismaclientknownerror.exception';
import { PrismaExceptionValidationFilter } from './global/error/prismaclientvalidationerror.exception';
import { validationException } from './global/error/validationError';
import cookieParser from 'cookie-parser';
import { SSO_ROUTE_PREFIX } from './global/constants/routePrefix.constant';

async function bootstrap() {
  const app = await NestFactory.create<NestExpressApplication>(AppModule);

  app.use(
    helmet({
      contentSecurityPolicy: {
        useDefaults: false,
        directives: {
          'default-src': ["'none'"],
          'frame-ancestors': ["'none'"],
          'base-uri': ["'none'"],
          'form-action': ["'none'"],
        },
      },
      crossOriginResourcePolicy: { policy: 'same-site' },
      referrerPolicy: { policy: 'same-origin' },
      frameguard: { action: 'deny' },
    }),
  );

  app.disable('x-powered-by');

  const trustProxy = process.env.TRUST_PROXY?.trim();

  if (trustProxy) {
    app.set('trust proxy', Number(trustProxy) || trustProxy);
  }

  app.setGlobalPrefix(SSO_ROUTE_PREFIX);
  app.useGlobalFilters(
    new PrismaExceptionFilter(),
    new PrismaExceptionValidationFilter(),
  );
  app.use(cookieParser());
  app.useGlobalPipes(
    new ValidationPipe({
      whitelist: true,
      forbidNonWhitelisted: true,
      transform: true,
      exceptionFactory: validationException,
    }),
  );
  await app.listen(process.env.PORT ?? 8080);
}
void bootstrap();
