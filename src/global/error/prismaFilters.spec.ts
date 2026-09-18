import { ArgumentsHost, Logger } from '@nestjs/common';
import { Prisma } from 'generated/prisma/client';
import { PrismaExceptionFilter } from './prismaclientknownerror.exception';
import { PrismaExceptionValidationFilter } from './prismaclientvalidationerror.exception';

interface FakeResponse {
  status(code: number): FakeResponse;
  json(body: Record<string, unknown>): FakeResponse;
}

/** Resposta de mentira: guarda o status e o corpo que o filtro escreveu. */
function fakeHost() {
  const sent: { status?: number; body?: Record<string, unknown> } = {};
  const response: FakeResponse = {
    status(code) {
      sent.status = code;
      return response;
    },
    json(body) {
      sent.body = body;
      return response;
    },
  };
  const host = {
    switchToHttp: () => ({ getResponse: (): FakeResponse => response }),
  } as unknown as ArgumentsHost;

  return { host, sent };
}

/**
 * A mensagem do Prisma traz a consulta, com nomes do schema e valores gravados.
 * Ela vai para o log; ao cliente vai so o codigo. Antes, o filtro de validacao
 * devolvia a ultima linha dela no corpo.
 */
describe('filtros do Prisma', () => {
  beforeAll(() => {
    // O texto do Prisma vai para o log de proposito; no teste so polui a saida.
    jest.spyOn(Logger.prototype, 'warn').mockImplementation(() => undefined);
    jest.spyOn(Logger.prototype, 'error').mockImplementation(() => undefined);
  });

  it('valor recusado pelo Prisma vira validation_failed, sem o texto dele', () => {
    const { host, sent } = fakeHost();
    const erro = new Prisma.PrismaClientValidationError(
      'Invalid `prisma.user.create()` invocation:\n\n' +
        '{ data: { email: "pessoa@exemplo.com" } }\n\n' +
        'Argument `name` is missing.',
      { clientVersion: '7' },
    );

    new PrismaExceptionValidationFilter().catch(erro, host);

    expect(sent.status).toBe(400);
    expect(sent.body).toEqual({
      statusCode: 400,
      error: 'validation_failed',
      message: expect.any(String) as unknown,
    });
    expect(JSON.stringify(sent.body)).not.toMatch(/Argument|pessoa@|prisma\./);
  });

  it('chave repetida vira duplicate, sem dizer qual campo', () => {
    const { host, sent } = fakeHost();
    const erro = new Prisma.PrismaClientKnownRequestError(
      'Unique constraint failed on the fields: (`email`)',
      { code: 'P2002', clientVersion: '7', meta: { target: ['email'] } },
    );

    new PrismaExceptionFilter().catch(erro, host);

    expect(sent.status).toBe(409);
    expect(sent.body?.error).toBe('duplicate');
    expect(JSON.stringify(sent.body)).not.toContain('email');
  });

  it('outro erro do banco vira internal_error, sem o texto dele', () => {
    const { host, sent } = fakeHost();
    const erro = new Prisma.PrismaClientKnownRequestError(
      'An operation failed because it depends on one or more records that were required but not found. No record with id "abc"',
      { code: 'P2025', clientVersion: '7', meta: { modelName: 'User' } },
    );

    new PrismaExceptionFilter().catch(erro, host);

    expect(sent.status).toBe(500);
    expect(sent.body?.error).toBe('internal_error');
    expect(JSON.stringify(sent.body)).not.toMatch(/record|abc|User/);
  });
});
