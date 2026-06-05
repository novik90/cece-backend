import { z } from 'zod';

/**
 * Stable error codes returned by the API. The HTTP status is chosen per
 * endpoint (see the v1 contract); this is the machine-readable `code`.
 */
export const errorCodeSchema = z.enum([
  'validation_error',
  'unauthorized',
  'invalid_credentials',
  'email_taken',
  'handle_taken',
  'user_not_found',
  'match_not_found',
  'not_participant',
]);
export type ErrorCode = z.infer<typeof errorCodeSchema>;

/** Uniform error envelope: `{ "error": { "code", "message" } }`. */
export const errorResponseSchema = z.object({
  error: z.object({
    code: z.string(),
    message: z.string(),
  }),
});
export type ErrorResponse = z.infer<typeof errorResponseSchema>;
