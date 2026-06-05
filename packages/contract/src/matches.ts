import { z } from 'zod';
import { idSchema, bestOfSchema, displayNameSchema } from './primitives';
import { matchSchema, matchSummarySchema } from './match';

/**
 * Opponent for a new match: an existing user or an ad-hoc guest.
 * Exactly one shape — providing both/neither fails validation.
 */
export const opponentSchema = z.union([
  z.object({ userId: idSchema }).strict(),
  z.object({ guestName: displayNameSchema }).strict(),
]);
export type Opponent = z.infer<typeof opponentSchema>;

/** C5 — POST /v1/matches. Creator becomes participants[0]. */
export const createMatchRequestSchema = z.object({
  opponent: opponentSchema,
  bestOf: bestOfSchema,
});
export type CreateMatchRequest = z.infer<typeof createMatchRequestSchema>;

/** C5/C7 response — the full match. */
export const matchResponseSchema = matchSchema;
export type MatchResponse = z.infer<typeof matchResponseSchema>;

/** C6 — GET /v1/matches?status=all|live|completed (only my matches). */
export const matchListStatusSchema = z.enum(['all', 'live', 'completed']);
export type MatchListStatus = z.infer<typeof matchListStatusSchema>;

export const matchListQuerySchema = z.object({
  status: matchListStatusSchema.default('all'),
});
export type MatchListQuery = z.infer<typeof matchListQuerySchema>;

export const matchListResponseSchema = z.object({
  matches: z.array(matchSummarySchema),
});
export type MatchListResponse = z.infer<typeof matchListResponseSchema>;
