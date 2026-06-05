import { PipeTransform } from '@nestjs/common';
import type { ZodSchema } from 'zod';
import { ApiError } from './api-error';

/**
 * Validates and parses input against a zod schema from `@cece/contract`.
 * On failure returns `422 validation_error` in the contract error format.
 */
export class ZodValidationPipe<T> implements PipeTransform<unknown, T> {
  constructor(private readonly schema: ZodSchema<T>) {}

  transform(value: unknown): T {
    const result = this.schema.safeParse(value);
    if (!result.success) {
      const message = result.error.issues
        .map((i) => `${i.path.join('.') || '(root)'}: ${i.message}`)
        .join('; ');
      throw new ApiError(422, 'validation_error', message || 'Validation failed');
    }
    return result.data;
  }
}
