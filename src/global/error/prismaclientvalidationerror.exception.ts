import { ArgumentsHost, Catch, ExceptionFilter, Logger } from '@nestjs/common';
import { Response } from 'express';
import { Prisma } from 'generated/prisma/client';
import { sendApiError } from './apiError';

/**
 * O Prisma recusou valores que os DTOs deixaram passar. Antes, a ultima linha
 * da mensagem dele ia ao cliente, e ela nomeia os argumentos do schema
 * (``Argument `name` is missing.``). Agora fica no log, onde serve de aviso de
 * DTO que nao acompanha o schema, e o cliente recebe a recusa generica.
 */
@Catch(Prisma.PrismaClientValidationError)
export class PrismaExceptionValidationFilter implements ExceptionFilter {
  private readonly logger = new Logger(PrismaExceptionValidationFilter.name);

  catch(exception: Prisma.PrismaClientValidationError, host: ArgumentsHost) {
    const response = host.switchToHttp().getResponse<Response>();
    const lines = exception.message.trim().split('\n');

    this.logger.warn(`o Prisma recusou os valores: ${lines[lines.length - 1]}`);
    sendApiError(response, 'validation_failed');
  }
}
