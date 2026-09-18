import { ArgumentsHost, Catch, ExceptionFilter, Logger } from '@nestjs/common';
import { Response } from 'express';
import { Prisma } from 'generated/prisma/client';
import { sendApiError } from './apiError';

/**
 * Erro do banco vira codigo, nunca texto do Prisma. A mensagem dele traz a
 * consulta, e com ela nomes de tabela, de coluna e ate valores gravados: fica
 * no log, e so o codigo e o alvo, que nao carregam dado de ninguem.
 */
@Catch(Prisma.PrismaClientKnownRequestError)
export class PrismaExceptionFilter implements ExceptionFilter {
  private readonly logger = new Logger(PrismaExceptionFilter.name);

  catch(exception: Prisma.PrismaClientKnownRequestError, host: ArgumentsHost) {
    const response = host.switchToHttp().getResponse<Response>();

    if (exception.code === 'P2002') {
      sendApiError(response, 'duplicate');
      return;
    }

    const target: unknown = exception.meta?.target ?? exception.meta?.modelName;

    this.logger.error(
      `erro do banco ${exception.code}${target ? ` em ${JSON.stringify(target)}` : ''}`,
    );
    sendApiError(response, 'internal_error');
  }
}
