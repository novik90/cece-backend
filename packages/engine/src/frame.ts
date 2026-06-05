import { BALL_VALUES, type Ball, type FrameState, type ScoringAction, type Slot } from '@cece/contract';
import { EngineError } from './error';

/**
 * In-frame actions handled by the core reducer. Frame/match completion,
 * concede and undo are orchestrated at the match level (separate task).
 */
export type FrameAction = Extract<ScoringAction, { type: 'pot' | 'foul' | 'endVisit' }>;

/** Final colour sequence after all reds are gone. */
const COLORS_SEQUENCE: readonly Ball[] = ['yellow', 'green', 'brown', 'blue', 'pink', 'black'];
const COLORS_TOTAL = 27; // 2+3+4+5+6+7

const REDS_AT_START = 15;

const other = (slot: Slot): Slot => (slot === 0 ? 1 : 0);

function addPoints(scores: readonly [number, number], slot: Slot, value: number): [number, number] {
  return slot === 0 ? [scores[0] + value, scores[1]] : [scores[0], scores[1] + value];
}

/** Points still on the table — used for the auto-end and the "needs snookers" hint. */
function pointsRemaining(phase: FrameState['phase'], redsRemaining: number, colorOn?: Ball): number {
  if (phase === 'colors') {
    if (!colorOn) return 0;
    const from = COLORS_SEQUENCE.indexOf(colorOn);
    return COLORS_SEQUENCE.slice(from).reduce((sum, b) => sum + BALL_VALUES[b], 0);
  }
  if (redsRemaining > 0) return redsRemaining * 8 + COLORS_TOTAL; // each red worth up to red+black
  return BALL_VALUES.black + COLORS_TOTAL; // free colour after the last red, then clearance
}

/** Fresh frame, striker = breaker, full table. */
export function initialFrameState(frameNumber: number, breaker: Slot): FrameState {
  return {
    frameNumber,
    breaker,
    striker: breaker,
    scores: [0, 0],
    redsRemaining: REDS_AT_START,
    phase: 'reds',
    currentBreak: { striker: breaker, points: 0 },
    pointsRemaining: pointsRemaining('reds', REDS_AT_START),
    status: 'in_progress',
  };
}

/**
 * Apply a pot/foul/endVisit to a frame. Pure: returns a new state, throws
 * {@link EngineError} (`invalid_action`) when the action can't apply.
 * Does NOT complete the frame — that's detected at the match level.
 */
export function applyScoringAction(state: FrameState, action: FrameAction): FrameState {
  if (state.status !== 'in_progress') {
    throw new EngineError('invalid_action', 'Frame is not in progress');
  }
  switch (action.type) {
    case 'pot':
      return applyPot(state, action.ball);
    case 'foul':
      return applyFoul(state, action.points);
    case 'endVisit':
      return endVisit(state);
  }
}

function applyPot(state: FrameState, ball: Ball): FrameState {
  const value = BALL_VALUES[ball];
  const scores = addPoints(state.scores, state.striker, value);
  const currentBreak = { striker: state.striker, points: state.currentBreak.points + value };

  if (state.phase === 'colors') {
    if (ball !== state.colorOn) {
      throw new EngineError('invalid_action', `Expected ${state.colorOn ?? 'no ball'}, got ${ball}`);
    }
    const next = COLORS_SEQUENCE[COLORS_SEQUENCE.indexOf(ball) + 1]; // undefined after black
    return {
      ...state,
      scores,
      currentBreak,
      colorOn: next,
      pointsRemaining: pointsRemaining('colors', 0, next),
    };
  }

  // reds phase
  if (ball === 'red') {
    if (state.redsRemaining === 0) {
      throw new EngineError('invalid_action', 'No reds remaining');
    }
    const redsRemaining = state.redsRemaining - 1;
    return {
      ...state,
      scores,
      currentBreak,
      redsRemaining,
      pointsRemaining: pointsRemaining('reds', redsRemaining),
    };
  }

  // a colour during the reds phase
  if (state.redsRemaining === 0) {
    // the free colour after the last red → the final colour sequence begins
    return {
      ...state,
      scores,
      currentBreak,
      phase: 'colors',
      colorOn: 'yellow',
      pointsRemaining: pointsRemaining('colors', 0, 'yellow'),
    };
  }
  // colour re-spotted; table unchanged otherwise
  return { ...state, scores, currentBreak };
}

function applyFoul(state: FrameState, points: number): FrameState {
  const beneficiary = other(state.striker);
  return {
    ...state,
    scores: addPoints(state.scores, beneficiary, points),
    striker: beneficiary,
    currentBreak: { striker: beneficiary, points: 0 },
  };
}

function endVisit(state: FrameState): FrameState {
  const next = other(state.striker);
  return { ...state, striker: next, currentBreak: { striker: next, points: 0 } };
}
