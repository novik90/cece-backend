import { HttpException } from '@nestjs/common';
import type { ErrorCode } from '@cece/contract';

/**
 * Domain error that already carries the contract error envelope
 * `{ error: { code, message } }`, so the body is returned verbatim.
 */
export class ApiError extends HttpException {
  constructor(status: number, code: ErrorCode, message: string) {
    super({ error: { code, message } }, status);
  }
}
