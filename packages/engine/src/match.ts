import type { FrameState, MatchLiveState, Slot } from '@cece/contract';
import { initialFrameState, applyScoringAction, type FrameAction } from './frame';
import { EngineError } from './error';

/** Everything the engine needs to spin up a live match (from the persisted Match). */
export interface NewMatchParams {
  matchId: string;
  bestOf: number;
  participants: MatchLiveState['participants'];
  selfScoringDisabled: boolean;
  firstBreaker: Slot;
}

const other = (slot: Slot): Slot => (slot === 0 ? 1 : 0);

/** Frames a player must win to take the match (bestOf is odd). */
const framesToWin = (bestOf: number): number => Math.floor(bestOf / 2) + 1;

/** Initial live state: frame 1 ready, match still `scheduled` until the first action. */
export function initialMatchState(p: NewMatchParams): MatchLiveState {
  return {
    matchId: p.matchId,
    status: 'scheduled',
    bestOf: p.bestOf,
    framesWon: [0, 0],
    selfScoringDisabled: p.selfScoringDisabled,
    participants: p.participants,
    frame: initialFrameState(1, p.firstBreaker),
    highestBreak: [0, 0],
    version: 0,
  };
}

/**
 * Apply an in-frame action at the match level: runs the frame reducer, tracks
 * `highestBreak`, and — when the table is cleared — settles the frame (winner,
 * framesWon), then either ends the match or starts the next frame with the
 * break alternated. Pure; throws {@link EngineError} when the action can't apply.
 *
 * Concede and undo are handled separately.
 */
export function reduceMatch(state: MatchLiveState, action: FrameAction): MatchLiveState {
  if (state.status === 'completed' || !state.frame) {
    throw new EngineError('match_not_live', 'Match is not live');
  }

  const frame = applyScoringAction(state.frame, action);
  const next: MatchLiveState = {
    ...state,
    status: 'live', // the first action makes the match live
    frame,
    highestBreak: bumpHighest(state.highestBreak, frame),
    version: state.version + 1,
  };

  return isTableCleared(frame) ? settleFrame(next, frame) : next;
}

/** Keep the running max single-visit break per slot. */
function bumpHighest(highest: readonly [number, number], frame: FrameState): [number, number] {
  const { striker, points } = frame.currentBreak;
  if (points <= highest[striker]) return [highest[0], highest[1]];
  return striker === 0 ? [points, highest[1]] : [highest[0], points];
}

/** Natural end of a frame: the final black has been potted. */
function isTableCleared(frame: FrameState): boolean {
  return frame.phase === 'colors' && frame.colorOn === undefined;
}

/**
 * Settle a cleared frame: award it to the higher score, bump `framesWon`, then
 * end the match (majority of bestOf) or open the next frame (break alternates).
 * A dead-heat at the clearance re-spots the black (full respotted-black rules
 * are deferred).
 */
function settleFrame(state: MatchLiveState, frame: FrameState): MatchLiveState {
  const [a, b] = frame.scores;

  if (a === b) {
    return { ...state, frame: { ...frame, colorOn: 'black', pointsRemaining: 7 } };
  }

  const winner: Slot = a > b ? 0 : 1;
  const framesWon: [number, number] =
    winner === 0
      ? [state.framesWon[0] + 1, state.framesWon[1]]
      : [state.framesWon[0], state.framesWon[1] + 1];

  if (framesWon[winner] >= framesToWin(state.bestOf)) {
    return { ...state, framesWon, status: 'completed', frame: undefined };
  }

  return {
    ...state,
    framesWon,
    frame: initialFrameState(frame.frameNumber + 1, other(frame.breaker)),
  };
}
