import type { ErrorCode } from '@cece/contract';

/**
 * Error thrown by the engine when an action can't be applied. Carries a contract
 * `ErrorCode` so the gateway can map it straight onto the `{ error }` envelope.
 */
export class EngineError extends Error {
  constructor(
    readonly code: ErrorCode,
    message: string,
  ) {
    super(message);
    this.name = 'EngineError';
  }
}
