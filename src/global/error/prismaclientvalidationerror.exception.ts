import { ArgumentsHost, Catch, ExceptionFilter, Logger } from '@nestjs/common';
import { Response } from 'express';
import { Prisma } from 'generated/prisma/client';
import { sendApiError } from './apiError';

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
