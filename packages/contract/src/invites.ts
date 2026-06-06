import { z } from 'zod';
import { idSchema, isoDateTimeSchema, bestOfSchema } from './primitives';
import { publicUserSchema } from './user';
import { firstBreakerSchema } from './matches';

/**
 * Lifecycle of a match invite. `pending` invites expire 24h after creation;
 * `expired` is computed lazily on read/accept (no cron job).
 */
export const matchInviteStatusSchema = z.enum([
  'pending',
  'accepted',
  'declined',
  'cancelled',
  'expired',
]);
export type MatchInviteStatus = z.infer<typeof matchInviteStatusSchema>;

/** A match invitation. Accepting it (I3) creates the match. */
export const matchInviteSchema = z.object({
  id: idSchema,
  from: publicUserSchema,
  to: publicUserSchema,
  bestOf: bestOfSchema,
  selfScoringDisabled: z.boolean(),
  /** Who breaks frame 1: 0 = sender, 1 = invitee. */
  firstBreaker: firstBreakerSchema,
  status: matchInviteStatusSchema,
  /** Present once accepted — the created match. */
  matchId: idSchema.optional(),
  createdAt: isoDateTimeSchema,
  /** `createdAt` + 24h; a pending invite past this is treated as expired. */
  expiresAt: isoDateTimeSchema,
});
export type MatchInvite = z.infer<typeof matchInviteSchema>;

/** I1 — POST /v1/invites. Carries the match options to apply on accept. */
export const createMatchInviteSchema = z
  .object({
    userId: idSchema,
    bestOf: bestOfSchema,
    selfScoringDisabled: z.boolean().default(false),
    firstBreaker: firstBreakerSchema.default(0),
  })
  .strict();
export type CreateMatchInvite = z.infer<typeof createMatchInviteSchema>;

/** I1 response — the freshly created invite. */
export const createMatchInviteResponseSchema = matchInviteSchema;
export type CreateMatchInviteResponse = z.infer<typeof createMatchInviteResponseSchema>;

/** Direction filter — invites sent to me (incoming) or by me (outgoing). */
export const matchInviteDirectionSchema = z.enum(['incoming', 'outgoing']);
export type MatchInviteDirection = z.infer<typeof matchInviteDirectionSchema>;

/** I2 — GET /v1/invites?direction=&status= (default incoming, any status). */
export const matchInviteListQuerySchema = z.object({
  direction: matchInviteDirectionSchema.default('incoming'),
  status: matchInviteStatusSchema.optional(),
});
export type MatchInviteListQuery = z.infer<typeof matchInviteListQuerySchema>;

export const matchInviteListResponseSchema = z.object({
  invites: z.array(matchInviteSchema),
});
export type MatchInviteListResponse = z.infer<typeof matchInviteListResponseSchema>;
