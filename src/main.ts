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

  /*
   * Cabecalhos de seguranca. O que sai daqui e JSON ou redirect: nenhum script,
   * estilo ou frame nasce deste servidor, entao a politica pode ser a mais
   * fechada que existe. Helmet tambem manda `nosniff`, `X-Frame-Options: DENY`
   * e HSTS, que o navegador so honra sobre HTTPS.
   */
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
      // `SAMEORIGIN` e o padrao do helmet; aqui nada precisa ser embutido, nem
      // pela propria origem. O `frame-ancestors` acima diz o mesmo aos
      // navegadores atuais, e este cobre os antigos.
      frameguard: { action: 'deny' },
    }),
  );

  // Anunciar a stack so ajuda quem procura alvo por versao conhecida.
  app.disable('x-powered-by');

  /*
   * Atras de proxy, o IP de quem pediu chega em `X-Forwarded-For`. `TRUST_PROXY`
   * diz quantos saltos confiar; sem ela o cabecalho e ignorado, e no limite de
   * requisicoes todo mundo conta como o proxy. Ligar sem proxy na frente e pior
   * que nao ligar: qualquer um escolheria o proprio IP no cabecalho.
   */
  const trustProxy = process.env.TRUST_PROXY?.trim();

  if (trustProxy) {
    app.set('trust proxy', Number(trustProxy) || trustProxy);
  }

  app.setGlobalPrefix(SSO_ROUTE_PREFIX);
  // Erro do Prisma vira codigo; o texto dele, que traz a consulta, fica no log.
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
      // A recusa sai com codigo por campo, no contrato de erro da API. No OAuth,
      // OAuthValidationFilter a reescreve no formato da RFC 6749.
      exceptionFactory: validationException,
    }),
  );
  await app.listen(process.env.PORT ?? 8080);
}
void bootstrap();
