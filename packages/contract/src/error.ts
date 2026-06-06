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
  // Phase 2 — real-time scoring
  'match_not_live',
  'invalid_action',
  'self_scoring_forbidden',
  'nothing_to_undo',
  'version_conflict',
  // Phase 3 — friends & match invites
  'already_friends',
  'friend_request_exists',
  'friend_request_not_found',
  'request_not_pending',
  'not_friends',
  'invite_not_found',
  'invite_not_pending',
  'invite_expired',
  'forbidden',
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
