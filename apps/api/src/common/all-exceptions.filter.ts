import { ArgumentsHost, Catch, ExceptionFilter, HttpException } from '@nestjs/common';
import type { Response } from 'express';

/** Generic HTTP status → error code for exceptions not thrown as ApiError. */
function codeForStatus(status: number): string {
  switch (status) {
    case 400:
      return 'bad_request';
    case 401:
      return 'unauthorized';
    case 403:
      return 'forbidden';
    case 404:
      return 'not_found';
    case 422:
      return 'validation_error';
    default:
      return status >= 500 ? 'internal_error' : 'error';
  }
}

/** Ensures every error response uses the contract envelope `{ error: { code, message } }`. */
@Catch()
export class AllExceptionsFilter implements ExceptionFilter {
  catch(exception: unknown, host: ArgumentsHost): void {
    const res = host.switchToHttp().getResponse<Response>();

    if (exception instanceof HttpException) {
      const status = exception.getStatus();
      const body = exception.getResponse();

      // ApiError (and anything already shaped) passes through untouched.
      if (body && typeof body === 'object' && 'error' in body) {
        res.status(status).json(body);
        return;
      }

      const raw =
        typeof body === 'string'
          ? body
          : ((body as { message?: unknown }).message ?? exception.message);
      const message = Array.isArray(raw) ? raw.join('; ') : String(raw);
      res.status(status).json({ error: { code: codeForStatus(status), message } });
      return;
    }

    res.status(500).json({ error: { code: 'internal_error', message: 'Internal server error' } });
  }
}
