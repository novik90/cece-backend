import { z } from 'zod';
import { idSchema, bestOfSchema } from './primitives';
import { matchStatusSchema, framesWonSchema, participantSchema } from './match';
import { errorResponseSchema } from './error';

/**
 * @cece/contract — real-time scoring (Phase 2).
 * See Obsidian: `cece app/cece-backend/Контракты v2 — Real-time скоринг`.
 *
 * The server is authoritative: clients send actions over Socket.IO, the engine
 * validates and applies them, and the room receives the full `MatchLiveState`.
 */

const nonNegIntSchema = z.number().int().nonnegative();

/** Participant slot in a match: 0 or 1 (aligns with `participants`/`framesWon`). */
export const slotSchema = z.union([z.literal(0), z.literal(1)]);
export type Slot = z.infer<typeof slotSchema>;

/** A snooker ball. */
export const ballSchema = z.enum(['red', 'yellow', 'green', 'brown', 'blue', 'pink', 'black']);
export type Ball = z.infer<typeof ballSchema>;

/** Point value of each ball. */
export const BALL_VALUES: Record<Ball, number> = {
  red: 1,
  yellow: 2,
  green: 3,
  brown: 4,
  blue: 5,
  pink: 6,
  black: 7,
};

/** Foul value awarded to the opponent: 4..7. */
export const foulPointsSchema = z.number().int().min(4).max(7);

/** Frame phase: reds (with colours re-spotted) then the final colour sequence. */
export const framePhaseSchema = z.enum(['reds', 'colors']);
export type FramePhase = z.infer<typeof framePhaseSchema>;

/** Live counter of the current visit's points, attributed to the striker. */
export const breakSchema = z.object({
  striker: slotSchema,
  points: nonNegIntSchema,
});
export type Break = z.infer<typeof breakSchema>;

/** State of the current (or just-finished) frame. */
export const frameStateSchema = z.object({
  frameNumber: z.number().int().positive(),
  breaker: slotSchema,
  striker: slotSchema,
  scores: z.tuple([nonNegIntSchema, nonNegIntSchema]),
  redsRemaining: z.number().int().min(0).max(15),
  phase: framePhaseSchema,
  colorOn: ballSchema.optional(), // in the 'colors' phase: which colour is next
  currentBreak: breakSchema,
  pointsRemaining: nonNegIntSchema, // points still on the table
  freeBallAvailable: z.boolean(), // striker may take a free ball (offered after a foul)
  respottedBlack: z.boolean(), // sudden death: only the re-spotted black is on
  status: z.enum(['in_progress', 'completed']),
  winner: slotSchema.optional(), // set when the frame completes
});
export type FrameState = z.infer<typeof frameStateSchema>;

/** Full live state broadcast to the match room (server → client). */
export const matchLiveStateSchema = z.object({
  matchId: idSchema,
  status: matchStatusSchema,
  bestOf: bestOfSchema,
  framesWon: framesWonSchema,
  selfScoringDisabled: z.boolean(),
  participants: z.tuple([participantSchema, participantSchema]),
  frame: frameStateSchema.optional(), // absent once the match is completed
  highestBreak: z.tuple([nonNegIntSchema, nonNegIntSchema]),
  version: nonNegIntSchema, // monotonic; bumped on each applied event
});
export type MatchLiveState = z.infer<typeof matchLiveStateSchema>;

// ── Actions (client → server) ───────────────────────────────────────────────

/** Per-event payloads (validated by the gateway for each named socket event). */
export const potPayloadSchema = z.object({ ball: ballSchema }).strict();
export type PotPayload = z.infer<typeof potPayloadSchema>;

export const foulPayloadSchema = z.object({ points: foulPointsSchema }).strict();
export type FoulPayload = z.infer<typeof foulPayloadSchema>;

export const noPayloadSchema = z.object({}).strict();

export const matchJoinSchema = z.object({ matchId: idSchema }).strict();
export type MatchJoin = z.infer<typeof matchJoinSchema>;

/**
 * Canonical scoring action, tagged by `type` — the shape stored in the
 * `match_events` log and fed to the engine. Frame/match completion is derived
 * by the engine, not sent as an action.
 */
export const scoringActionSchema = z.discriminatedUnion('type', [
  potPayloadSchema.extend({ type: z.literal('pot') }),
  foulPayloadSchema.extend({ type: z.literal('foul') }),
  noPayloadSchema.extend({ type: z.literal('freeBall') }),
  noPayloadSchema.extend({ type: z.literal('endVisit') }),
  noPayloadSchema.extend({ type: z.literal('concedeFrame') }),
  noPayloadSchema.extend({ type: z.literal('concedeMatch') }),
  noPayloadSchema.extend({ type: z.literal('undo') }),
]);
export type ScoringAction = z.infer<typeof scoringActionSchema>;
export type ScoringActionType = ScoringAction['type'];

// ── Transport (Socket.IO) ────────────────────────────────────────────────────

/** Client → server socket event names. */
export const WS_CLIENT_EVENTS = {
  join: 'match:join',
  pot: 'score:pot',
  foul: 'score:foul',
  freeBall: 'score:freeBall',
  endVisit: 'score:endVisit',
  concedeFrame: 'frame:concede',
  concedeMatch: 'match:concede',
  undo: 'score:undo',
} as const;

/** Server → client socket event names. */
export const WS_SERVER_EVENTS = {
  state: 'match:state',
  error: 'match:error',
} as const;

/** `match:state` payload — the full live state. */
export const matchStateEventSchema = matchLiveStateSchema;

/** Ack returned to the sender of an action. */
export const actionAckSchema = z.union([
  z.object({ ok: z.literal(true), version: nonNegIntSchema }),
  errorResponseSchema,
]);
export type ActionAck = z.infer<typeof actionAckSchema>;
