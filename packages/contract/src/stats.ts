import { z } from 'zod';
import { idSchema, isoDateTimeSchema } from './primitives';
import { participantSchema } from './match';

const nonNegIntSchema = z.number().int().nonnegative();

/**
 * A notable break: the player's highest single-visit break in one match, with
 * enough context to show it on a stats screen. (Only per-match highs are kept by
 * the engine, so `topBreaks` lists the best break from each match, not every break.)
 */
export const breakStatSchema = z.object({
  value: z.number().int().positive(),
  matchId: idSchema,
  opponent: participantSchema,
  playedAt: isoDateTimeSchema,
});
export type BreakStat = z.infer<typeof breakStatSchema>;

/** Aggregated stats for a user over their completed matches. */
export const userStatsSchema = z.object({
  userId: idSchema,
  matchesPlayed: nonNegIntSchema,
  wins: nonNegIntSchema,
  losses: nonNegIntSchema,
  winRate: z.number().min(0).max(1), // fraction of completed matches won (0 if none)
  framesWon: nonNegIntSchema,
  framesLost: nonNegIntSchema,
  highestBreak: nonNegIntSchema,
  topBreaks: z.array(breakStatSchema),
});
export type UserStats = z.infer<typeof userStatsSchema>;
