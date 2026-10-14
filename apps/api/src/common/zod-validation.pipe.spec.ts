import { BadRequestException } from '@nestjs/common';
import { describe, expect, it } from 'vitest';
import { zPaginationQuery } from '@nexo/contracts';
import { ZodValidationPipe } from './zod-validation.pipe';

describe('ZodValidationPipe', () => {
  const pipe = new ZodValidationPipe(zPaginationQuery);

  it('aplica valores por defecto cuando faltan campos', () => {
    expect(pipe.transform({})).toEqual({ page: 1, pageSize: 25 });
  });

  it('coerce strings numéricos (query params)', () => {
    expect(pipe.transform({ page: '3', pageSize: '10' })).toEqual({ page: 3, pageSize: 10 });
  });

  it('rechaza valores fuera de rango con detalles', () => {
    try {
      pipe.transform({ page: 0, pageSize: 9999 });
      throw new Error('debió lanzar BadRequestException');
    } catch (error) {
      expect(error).toBeInstanceOf(BadRequestException);
      const response = (error as BadRequestException).getResponse() as { details: unknown[] };
      expect(Array.isArray(response.details)).toBe(true);
      expect(response.details.length).toBeGreaterThan(0);
    }
  });
});
