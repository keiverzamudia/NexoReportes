import { ArgumentsHost, Catch, ExceptionFilter, HttpException, HttpStatus, Logger } from '@nestjs/common';
import { Request, Response } from 'express';
import { randomUUID } from 'node:crypto';

// Filtro global: forma de error consistente { statusCode, message, details?, correlationId }.
// Nunca filtrar mensajes técnicos internos ni credenciales al cliente.
@Catch()
export class AllExceptionsFilter implements ExceptionFilter {
  private readonly logger = new Logger(AllExceptionsFilter.name);

  catch(exception: unknown, host: ArgumentsHost) {
    const ctx = host.switchToHttp();
    const response = ctx.getResponse<Response>();
    const request = ctx.getRequest<Request & { correlationId?: string }>();
    const correlationId = request.correlationId ?? randomUUID();

    let status = HttpStatus.INTERNAL_SERVER_ERROR;
    let message = 'Error interno del servidor';
    let details: unknown;

    if (exception instanceof HttpException) {
      status = exception.getStatus();
      const body = exception.getResponse();
      if (typeof body === 'string') {
        message = body;
      } else if (typeof body === 'object' && body !== null) {
        const parsed = body as { message?: string | string[]; error?: string; details?: unknown };
        message = Array.isArray(parsed.message) ? parsed.message.join('; ') : (parsed.message ?? exception.message);
        details = parsed.details;
      }
    } else {
      // Log completo del error no controlado; al cliente solo mensaje genérico.
      this.logger.error(
        `Excepción no controlada [${correlationId}] ${request.method} ${request.url}`,
        exception instanceof Error ? exception.stack : String(exception),
      );
    }

    response.status(status).json({ statusCode: status, message, details, correlationId });
  }
}
