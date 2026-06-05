import { describe, it, expect } from 'vitest';
import {
  ballSchema,
  BALL_VALUES,
  slotSchema,
  foulPointsSchema,
  frameStateSchema,
  matchLiveStateSchema,
  scoringActionSchema,
  errorCodeSchema,
} from './index';

const participants = [
  { kind: 'user', userId: 'u1', handle: 'ivan', displayName: 'Иван' },
  { kind: 'guest', name: 'Гость' },
] as const;

const frame = {
  frameNumber: 1,
  breaker: 0,
  striker: 0,
  scores: [0, 0],
  redsRemaining: 15,
  phase: 'reds',
  currentBreak: { striker: 0, points: 0 },
  pointsRemaining: 147,
  status: 'in_progress',
} as const;

const liveState = {
  matchId: 'm1',
  status: 'live',
  bestOf: 5,
  framesWon: [0, 0],
  selfScoringDisabled: false,
  participants,
  frame,
  highestBreak: [0, 0],
  version: 0,
} as const;

describe('ballSchema / BALL_VALUES', () => {
  it('accepts the seven balls and rejects others', () => {
    for (const b of ['red', 'yellow', 'green', 'brown', 'blue', 'pink', 'black']) {
      expect(ballSchema.safeParse(b).success).toBe(true);
    }
    expect(ballSchema.safeParse('white').success).toBe(false);
  });
  it('maps each ball to its point value', () => {
    expect(BALL_VALUES).toEqual({
      red: 1,
      yellow: 2,
      green: 3,
      brown: 4,
      blue: 5,
      pink: 6,
      black: 7,
    });
  });
});

describe('slotSchema', () => {
  it('accepts 0 and 1 only', () => {
    expect(slotSchema.safeParse(0).success).toBe(true);
    expect(slotSchema.safeParse(1).success).toBe(true);
    for (const s of [2, -1, '0']) expect(slotSchema.safeParse(s).success).toBe(false);
  });
});

describe('foulPointsSchema', () => {
  it('accepts 4..7', () => {
    for (const n of [4, 5, 6, 7]) expect(foulPointsSchema.safeParse(n).success).toBe(true);
  });
  it('rejects out-of-range and non-integers', () => {
    for (const n of [3, 8, 4.5]) expect(foulPointsSchema.safeParse(n).success).toBe(false);
  });
});

describe('frameStateSchema', () => {
  it('parses an opening frame', () => {
    expect(frameStateSchema.safeParse(frame).success).toBe(true);
  });
  it('rejects redsRemaining out of 0..15', () => {
    expect(frameStateSchema.safeParse({ ...frame, redsRemaining: 16 }).success).toBe(false);
  });
});

describe('matchLiveStateSchema', () => {
  it('parses a live match with a frame', () => {
    expect(matchLiveStateSchema.safeParse(liveState).success).toBe(true);
  });
  it('parses a completed match without a frame', () => {
    const { frame: _omit, ...rest } = liveState;
    expect(
      matchLiveStateSchema.safeParse({ ...rest, status: 'completed', framesWon: [3, 1] }).success,
    ).toBe(true);
  });
});

describe('scoringActionSchema', () => {
  it('accepts each action variant', () => {
    const actions = [
      { type: 'pot', ball: 'red' },
      { type: 'foul', points: 4 },
      { type: 'endVisit' },
      { type: 'concedeFrame' },
      { type: 'concedeMatch' },
      { type: 'undo' },
    ];
    for (const a of actions) expect(scoringActionSchema.safeParse(a).success).toBe(true);
  });
  it('rejects an unknown action type', () => {
    expect(scoringActionSchema.safeParse({ type: 'teleport' }).success).toBe(false);
  });
  it('requires a ball for pot and rejects extra fields', () => {
    expect(scoringActionSchema.safeParse({ type: 'pot' }).success).toBe(false);
    expect(scoringActionSchema.safeParse({ type: 'endVisit', ball: 'red' }).success).toBe(false);
  });
  it('enforces the foul range', () => {
    expect(scoringActionSchema.safeParse({ type: 'foul', points: 3 }).success).toBe(false);
  });
});

describe('errorCodeSchema (Phase 2 codes)', () => {
  it.each([
    'match_not_live',
    'invalid_action',
    'self_scoring_forbidden',
    'nothing_to_undo',
    'version_conflict',
  ])('includes %s', (code) => {
    expect(errorCodeSchema.safeParse(code).success).toBe(true);
  });
});
