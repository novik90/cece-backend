import { describe, it, expect } from 'vitest';
import type { Ball, MatchLiveState, Slot } from '@cece/contract';
import {
  initialMatchState,
  reduceMatch,
  concedeFrame,
  concedeMatch,
  EngineError,
  type FrameAction,
} from './index';

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

describe('concede', () => {
  it('concedeFrame awards the frame to the opponent and opens the next', () => {
    let m = reduceMatch(newMatch(5, 0), { type: 'pot', ball: 'red' }); // slot 0 leads
    m = concedeFrame(m, 1); // slot 1 concedes
    expect(m.framesWon).toEqual([1, 0]);
    expect(m.status).toBe('live');
    expect(m.frame).toMatchObject({ frameNumber: 2, breaker: 1 });
  });

  it('concedeFrame can end the match at match point', () => {
    let m = clearFrameBy(newMatch(3, 0), 0); // 1-0
    m = concedeFrame(m, 1); // slot 1 concedes frame 2 → slot 0 → 2-0
    expect(m.status).toBe('completed');
    expect(m.framesWon).toEqual([2, 0]);
    expect(m.frame).toBeUndefined();
  });

  it('concedeMatch hands the match to the opponent immediately', () => {
    const m = concedeMatch(newMatch(5, 0), 0); // slot 0 concedes → slot 1 wins
    expect(m.status).toBe('completed');
    expect(m.framesWon).toEqual([0, 3]); // framesToWin(5) = 3
    expect(m.frame).toBeUndefined();
  });

  it('rejects conceding a completed match', () => {
    const done = concedeMatch(newMatch(3, 0), 0);
    expect(() => concedeFrame(done, 0)).toThrow(EngineError);
    expect(() => concedeMatch(done, 0)).toThrow(EngineError);
  });
});

describe('respotted black (sudden death)', () => {
  /** A live state parked with only the black on, given scores and striker. */
  function onlyBlack(scores: [number, number], striker: Slot): MatchLiveState {
    const live = reduceMatch(newMatch(3, 0), { type: 'pot', ball: 'red' });
    return {
      ...live,
      frame: {
        ...live.frame!,
        phase: 'colors',
        colorOn: 'black',
        redsRemaining: 0,
        scores,
        striker,
        currentBreak: { striker, points: 0 },
        pointsRemaining: 7,
        respottedBlack: false,
      },
    };
  }

  it('enters sudden death when potting the black ties the scores; the lot sets the striker', () => {
    const s = onlyBlack([3, 10], 0); // slot 0 is 7 behind
    const rb = reduceMatch(s, { type: 'pot', ball: 'black' }, 1); // lot → striker 1
    expect(rb.frame?.respottedBlack).toBe(true);
    expect(rb.frame?.colorOn).toBe('black');
    expect(rb.frame?.scores).toEqual([10, 10]);
    expect(rb.frame?.striker).toBe(1);
    expect(rb.framesWon).toEqual([0, 0]); // not settled
  });

  it('enters sudden death when a foul on the last black ties the scores', () => {
    const s = onlyBlack([10, 6], 0); // slot 0 striker, fouls 4 → slot 1 to 10
    const rb = reduceMatch(s, { type: 'foul', points: 4 }, 0); // lot → striker 0
    expect(rb.frame?.respottedBlack).toBe(true);
    expect(rb.frame?.scores).toEqual([10, 10]);
    expect(rb.frame?.striker).toBe(0);
  });

  it('does not enter sudden death when potting the black settles a lead', () => {
    const s = onlyBlack([20, 10], 0);
    const m = reduceMatch(s, { type: 'pot', ball: 'black' });
    expect(m.frame?.respottedBlack).toBeFalsy();
    expect(m.framesWon).toEqual([1, 0]); // slot 0 wins the frame
  });

  describe('actions in sudden death', () => {
    const rb = (): MatchLiveState => reduceMatch(onlyBlack([3, 10], 0), { type: 'pot', ball: 'black' }, 1);

    it('potting the black wins the frame for the striker', () => {
      const won = reduceMatch(rb(), { type: 'pot', ball: 'black' }); // striker 1
      expect(won.framesWon).toEqual([0, 1]);
      expect(won.frame?.respottedBlack).toBeFalsy(); // fresh next frame
    });

    it('a foul loses the frame for the striker', () => {
      const lost = reduceMatch(rb(), { type: 'foul', points: 4 }); // striker 1 fouls
      expect(lost.framesWon).toEqual([1, 0]);
    });

    it('endVisit passes the turn and stays in sudden death', () => {
      const passed = reduceMatch(rb(), { type: 'endVisit' });
      expect(passed.frame?.respottedBlack).toBe(true);
      expect(passed.frame?.striker).toBe(0); // switched from 1
    });

    it('rejects potting anything but the black', () => {
      expect(() => reduceMatch(rb(), { type: 'pot', ball: 'pink' })).toThrow(EngineError);
    });
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
