import { Test, TestingModule } from '@nestjs/testing';
import { INestApplication } from '@nestjs/common';
import request from 'supertest';
import { App } from 'supertest/types';
import { AppModule } from './../src/app.module';

/**
 * Exige as variaveis de ambiente do servidor (DATABASE_URL, COOKIE_SECRET,
 * KEY_ENCRYPTION_KEY, SSO_ISSUER, GOOGLE_*), porque o AppModule as le no boot.
 *
 * O teste do fluxo OAuth em si nao mora aqui: esta em test/oauth-e2e.js, que
 * roda contra o servidor de pe (`npm run test:oauth`).
 */
describe('AppController (e2e)', () => {
  let app: INestApplication<App>;

  beforeEach(async () => {
    const moduleFixture: TestingModule = await Test.createTestingModule({
      imports: [AppModule],
    }).compile();

    app = moduleFixture.createNestApplication();
    await app.init();
  });

  afterEach(async () => {
    await app.close();
  });

  it('/health (GET) responde ok', () => {
    return request(app.getHttpServer())
      .get('/health')
      .expect(200)
      .expect((res) => {
        expect(res.body).toMatchObject({ status: 'ok', service: 'sso' });
      });
  });
});
