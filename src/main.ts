import { NestFactory } from '@nestjs/core';
import { AppModule } from './app.module';
import { ValidationPipe } from '@nestjs/common';
import { PrismaExceptionFilter } from './global/error/prismaclientknownerror.exception';
import cookieParser from 'cookie-parser';
import { SSO_ROUTE_PREFIX } from './global/constants/routePrefix.constant';

async function bootstrap() {
  const app = await NestFactory.create(AppModule);
  app.setGlobalPrefix(SSO_ROUTE_PREFIX);
  app.useGlobalFilters(new PrismaExceptionFilter());
  app.use(cookieParser());
  app.useGlobalPipes(
    new ValidationPipe({
      whitelist: true,
      forbidNonWhitelisted: true,
      transform: true,
    }),
  );
  await app.listen(process.env.PORT ?? 8080);
}
void bootstrap();
