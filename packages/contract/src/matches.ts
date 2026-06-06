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

/** Which participant breaks the first frame: 0 = creator, 1 = opponent. */
export const firstBreakerSchema = z.union([z.literal(0), z.literal(1)]);

/** C5 — POST /v1/matches. Creator becomes participants[0]. */
export const createMatchRequestSchema = z
  .object({
    opponent: opponentSchema,
    bestOf: bestOfSchema,
    /** When true, a player can't score points for themselves (user-vs-user only). */
    selfScoringDisabled: z.boolean().default(false),
    /** Who breaks frame 1; subsequent frames alternate. Defaults to the creator. */
    firstBreaker: firstBreakerSchema.default(0),
  })
  .superRefine((val, ctx) => {
    if (val.selfScoringDisabled && 'guestName' in val.opponent) {
      ctx.addIssue({
        code: z.ZodIssueCode.custom,
        path: ['selfScoringDisabled'],
        message: 'selfScoringDisabled is only allowed against a registered user',
      });
    }
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
