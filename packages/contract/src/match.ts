import { z } from 'zod';
import { idSchema, isoDateTimeSchema, displayNameSchema, bestOfSchema } from './primitives';
import { publicUserSchema } from './user';

/**
 * Match participant: a registered user or a guest without an account.
 * A guest is shown as "Unknown player" in stats.
 */
export const participantSchema = z.discriminatedUnion('kind', [
  z.object({
    kind: z.literal('user'),
    userId: publicUserSchema.shape.id,
    handle: publicUserSchema.shape.handle,
    displayName: publicUserSchema.shape.displayName,
  }),
  z.object({
    kind: z.literal('guest'),
    name: displayNameSchema,
  }),
]);
export type Participant = z.infer<typeof participantSchema>;

export const matchStatusSchema = z.enum(['scheduled', 'live', 'completed']);
export type MatchStatus = z.infer<typeof matchStatusSchema>;

/** Frames won per participant, aligned with `participants`. */
export const framesWonSchema = z.tuple([
  z.number().int().nonnegative(),
  z.number().int().nonnegative(),
]);
export type FramesWon = z.infer<typeof framesWonSchema>;

export const matchSummarySchema = z.object({
  id: idSchema,
  participants: z.tuple([participantSchema, participantSchema]),
  bestOf: bestOfSchema,
  status: matchStatusSchema,
  framesWon: framesWonSchema,
  winner: participantSchema.optional(),
  createdAt: isoDateTimeSchema,
  completedAt: isoDateTimeSchema.optional(),
});
export type MatchSummary = z.infer<typeof matchSummarySchema>;

/**
 * Full match. `state` (frames/breaks/current score) is detailed in the
 * real-time contract (Phase 2); in Phase 1 the match is created empty.
 */
export const matchSchema = matchSummarySchema.extend({
  ownerId: idSchema,
  activeScorerUserId: idSchema.optional(),
});
export type Match = z.infer<typeof matchSchema>;
