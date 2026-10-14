import { BadRequestException, Injectable, PipeTransform } from '@nestjs/common';
import { ZodTypeAny, z } from 'zod';

// Pipe Zod genérico: valida y transforma cuerpos/queries con esquemas de @nexo/contracts.
@Injectable()
export class ZodValidationPipe<T extends ZodTypeAny> implements PipeTransform<unknown, z.infer<T>> {
  constructor(private readonly schema: T) {}

  transform(value: unknown): z.infer<T> {
    const result = this.schema.safeParse(value);
    if (!result.success) {
      const details = result.error.issues.map((issue) => ({
        path: issue.path.join('.'),
        message: issue.message,
      }));
      throw new BadRequestException({ message: 'Validación fallida', details });
    }
    return result.data;
  }
}
