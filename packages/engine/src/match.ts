import { BALL_VALUES, type FrameState, type MatchLiveState, type Slot } from '@cece/contract';
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

function addPoints(scores: readonly [number, number], slot: Slot, value: number): [number, number] {
  return slot === 0 ? [scores[0] + value, scores[1]] : [scores[0], scores[1] + value];
}

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
 *
 * When a dead-heat clears the table (or a foul ends the frame on the last
 * black) the frame enters sudden death — the **re-spotted black**. The first
 * striker is decided by a lot at the call site and passed in
 * `respottedBlackStriker` so the fold stays deterministic.
 */
export function reduceMatch(
  state: MatchLiveState,
  action: FrameAction,
  respottedBlackStriker?: Slot,
): MatchLiveState {
  if (state.status === 'completed' || !state.frame) {
    throw new EngineError('match_not_live', 'Match is not live');
  }
  if (state.frame.respottedBlack) return reduceRespottedBlack(state, state.frame, action);

  const wasOnlyBlack = state.frame.phase === 'colors' && state.frame.colorOn === 'black';
  const frame = applyScoringAction(state.frame, action);
  const next: MatchLiveState = {
    ...state,
    status: 'live', // the first action makes the match live
    frame,
    highestBreak: bumpHighest(state.highestBreak, frame),
    version: state.version + 1,
  };

  // The frame ends when the black is potted, or a foul is committed while the
  // black is the only ball on (WPBSA Sec 3 R4).
  const frameEnded = isTableCleared(frame) || (action.type === 'foul' && wasOnlyBlack);
  if (!frameEnded) return next;

  const [a, b] = frame.scores;
  if (a === b) return enterRespottedBlack(next, frame, respottedBlackStriker ?? 0);
  return settleFrame(next, frame, a > b ? 0 : 1);
}

/** Re-spot the black and start sudden death; `striker` comes from the lot. */
function enterRespottedBlack(
  state: MatchLiveState,
  frame: FrameState,
  striker: Slot,
): MatchLiveState {
  return {
    ...state,
    frame: {
      ...frame,
      respottedBlack: true,
      phase: 'colors',
      colorOn: 'black',
      redsRemaining: 0,
      striker,
      currentBreak: { striker, points: 0 },
      pointsRemaining: BALL_VALUES.black,
      freeBallAvailable: false,
      status: 'in_progress',
      winner: undefined,
    },
  };
}

/**
 * Sudden death on the re-spotted black: potting it wins the frame, a foul loses
 * it, `endVisit` passes the turn; anything else is invalid.
 */
function reduceRespottedBlack(
  state: MatchLiveState,
  frame: FrameState,
  action: FrameAction,
): MatchLiveState {
  const bumped: MatchLiveState = { ...state, status: 'live', version: state.version + 1 };

  switch (action.type) {
    case 'endVisit': {
      const striker = other(frame.striker);
      return { ...bumped, frame: { ...frame, striker, currentBreak: { striker, points: 0 } } };
    }
    case 'pot': {
      if (action.ball !== 'black') throw new EngineError('invalid_action', 'Only the black is on');
      const settled: FrameState = {
        ...frame,
        scores: addPoints(frame.scores, frame.striker, BALL_VALUES.black),
        colorOn: undefined,
        currentBreak: { striker: frame.striker, points: frame.currentBreak.points + BALL_VALUES.black },
      };
      const withHighest = { ...bumped, highestBreak: bumpHighest(state.highestBreak, settled) };
      return settleFrame(withHighest, settled, frame.striker);
    }
    case 'foul':
      return settleFrame(bumped, frame, other(frame.striker));
    default: // freeBall — not applicable in sudden death
      throw new EngineError('invalid_action', 'Only pot black / foul / endVisit are allowed');
  }
}

/** Concede the current frame: the opponent of `concedingSlot` wins it. */
export function concedeFrame(state: MatchLiveState, concedingSlot: Slot): MatchLiveState {
  if (state.status === 'completed' || !state.frame) {
    throw new EngineError('match_not_live', 'Match is not live');
  }
  const bumped: MatchLiveState = { ...state, status: 'live', version: state.version + 1 };
  return settleFrame(bumped, state.frame, other(concedingSlot));
}

/** Concede the match: the opponent of `concedingSlot` wins immediately. */
export function concedeMatch(state: MatchLiveState, concedingSlot: Slot): MatchLiveState {
  if (state.status === 'completed' || !state.frame) {
    throw new EngineError('match_not_live', 'Match is not live');
  }
  const winner = other(concedingSlot);
  const target = framesToWin(state.bestOf);
  const framesWon: [number, number] =
    winner === 0 ? [target, state.framesWon[1]] : [state.framesWon[0], target];
  return { ...state, status: 'completed', framesWon, frame: undefined, version: state.version + 1 };
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
 * Award a finished frame to `winner`, bump `framesWon`, then end the match
 * (majority of bestOf) or open the next frame with the break alternated.
 */
function settleFrame(state: MatchLiveState, frame: FrameState, winner: Slot): MatchLiveState {
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
