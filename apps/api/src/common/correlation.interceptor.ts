import { CallHandler, ExecutionContext, Injectable, NestInterceptor } from '@nestjs/common';
import { randomUUID } from 'node:crypto';
import { Observable } from 'rxjs';

// Asigna un correlationId por solicitud para trazabilidad en logs y respuestas de error.
@Injectable()
export class CorrelationInterceptor implements NestInterceptor {
  intercept(context: ExecutionContext, next: CallHandler): Observable<unknown> {
    if (context.getType() === 'http') {
      const request = context.switchToHttp().getRequest<{ correlationId?: string; headers: Record<string, string | undefined> }>();
      request.correlationId = request.headers['x-correlation-id'] ?? randomUUID();
    }
    return next.handle();
  }
}
