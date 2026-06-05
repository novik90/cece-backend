import { describe, it, expect } from 'vitest';
import type { Ball, MatchLiveState, Slot } from '@cece/contract';
import { initialMatchState, reduceMatch, EngineError, type FrameAction } from './index';

const participants: MatchLiveState['participants'] = [
  { kind: 'guest', name: 'A' },
  { kind: 'guest', name: 'B' },
];

function newMatch(bestOf: number, firstBreaker: Slot): MatchLiveState {
  return initialMatchState({
    matchId: 'm1',
    bestOf,
    participants,
    selfScoringDisabled: false,
    firstBreaker,
  });
}

/** Drive the current frame to a clearance won by `slot` (scores everything). */
function clearFrameBy(state: MatchLiveState, slot: Slot): MatchLiveState {
  let s = state;
  if (s.frame && s.frame.striker !== slot) s = reduceMatch(s, { type: 'endVisit' });
  const seq: FrameAction[] = [];
  for (let i = 0; i < 15; i++) seq.push({ type: 'pot', ball: 'red' });
  seq.push({ type: 'pot', ball: 'black' }); // free colour → colour sequence
  for (const c of ['yellow', 'green', 'brown', 'blue', 'pink', 'black'] as Ball[]) {
    seq.push({ type: 'pot', ball: c });
  }
  return seq.reduce(reduceMatch, s);
}

describe('initialMatchState', () => {
  it('is scheduled with frame 1 ready', () => {
    const m = newMatch(5, 1);
    expect(m.status).toBe('scheduled');
    expect(m.frame).toMatchObject({ frameNumber: 1, breaker: 1, striker: 1 });
    expect(m.framesWon).toEqual([0, 0]);
  });
});

describe('reduceMatch — live transition & guards', () => {
  it('the first action makes the match live', () => {
    const m = reduceMatch(newMatch(3, 0), { type: 'pot', ball: 'red' });
    expect(m.status).toBe('live');
    expect(m.version).toBe(1);
  });

  it('throws match_not_live once completed', () => {
    let m = clearFrameBy(newMatch(3, 0), 0);
    m = clearFrameBy(m, 0); // 2-0 in bestOf 3 → completed
    expect(m.status).toBe('completed');
    expect(() => reduceMatch(m, { type: 'pot', ball: 'red' })).toThrow(EngineError);
  });
});

describe('frame settlement', () => {
  it('awards a cleared frame and opens the next with the break alternated', () => {
    const m = clearFrameBy(newMatch(5, 0), 0);
    expect(m.framesWon).toEqual([1, 0]);
    expect(m.status).toBe('live');
    expect(m.frame).toMatchObject({ frameNumber: 2, breaker: 1, scores: [0, 0] });
  });

  it('alternates the break every frame', () => {
    let m = clearFrameBy(newMatch(7, 0), 0);
    expect(m.frame?.breaker).toBe(1);
    m = clearFrameBy(m, 0);
    expect(m.frame?.breaker).toBe(0);
  });
});

describe('match end', () => {
  it('completes at the majority of bestOf and drops the frame', () => {
    let m = clearFrameBy(newMatch(3, 0), 0);
    expect(m.framesWon).toEqual([1, 0]);
    m = clearFrameBy(m, 0);
    expect(m.status).toBe('completed');
    expect(m.framesWon).toEqual([2, 0]);
    expect(m.frame).toBeUndefined();
  });
});

describe('highestBreak', () => {
  it('tracks the running max single-visit break per slot', () => {
    let m = reduceMatch(newMatch(5, 0), { type: 'pot', ball: 'red' }); // slot 0: break 1
    m = reduceMatch(m, { type: 'pot', ball: 'black' }); // slot 0: break 8
    expect(m.highestBreak).toEqual([8, 0]);
    m = reduceMatch(m, { type: 'endVisit' }); // → slot 1
    m = reduceMatch(m, { type: 'pot', ball: 'red' }); // slot 1: break 1
    expect(m.highestBreak).toEqual([8, 1]);
  });
});
