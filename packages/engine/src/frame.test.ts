import { describe, it, expect } from 'vitest';
import type { Ball, FrameState } from '@cece/contract';
import { initialFrameState, applyScoringAction, EngineError, type FrameAction } from './index';

/** Fold a sequence of actions onto a frame. */
function play(state: FrameState, ...actions: FrameAction[]): FrameState {
  return actions.reduce(applyScoringAction, state);
}

const pot = (ball: Ball): FrameAction => ({ type: 'pot', ball });
const endVisit: FrameAction = { type: 'endVisit' };

describe('initialFrameState', () => {
  it('opens with 15 reds, striker = breaker, full table', () => {
    const f = initialFrameState(1, 1);
    expect(f).toMatchObject({
      frameNumber: 1,
      breaker: 1,
      striker: 1,
      scores: [0, 0],
      redsRemaining: 15,
      phase: 'reds',
      currentBreak: { striker: 1, points: 0 },
      pointsRemaining: 147,
      status: 'in_progress',
    });
  });
});

describe('pot — reds phase', () => {
  it('a red scores 1 and decrements reds', () => {
    const f = applyScoringAction(initialFrameState(1, 0), pot('red'));
    expect(f.scores).toEqual([1, 0]);
    expect(f.redsRemaining).toBe(14);
    expect(f.currentBreak).toEqual({ striker: 0, points: 1 });
    expect(f.striker).toBe(0); // visit continues
  });

  it('a colour after a red is re-spotted (reds unchanged) and grows the break', () => {
    const f = play(initialFrameState(1, 0), pot('red'), pot('black'));
    expect(f.scores).toEqual([8, 0]);
    expect(f.redsRemaining).toBe(14);
    expect(f.phase).toBe('reds');
    expect(f.currentBreak.points).toBe(8);
  });

  it('rejects potting a red when none remain', () => {
    let f = initialFrameState(1, 0);
    for (let i = 0; i < 15; i++) f = applyScoringAction(f, pot('red'));
    expect(f.redsRemaining).toBe(0);
    expect(() => applyScoringAction(f, pot('red'))).toThrow(EngineError);
  });
});

describe('endVisit', () => {
  it('switches striker and resets the break', () => {
    const f = play(initialFrameState(1, 0), pot('red'), endVisit);
    expect(f.striker).toBe(1);
    expect(f.currentBreak).toEqual({ striker: 1, points: 0 });
    expect(f.scores).toEqual([1, 0]); // scored points are kept
  });
});

describe('foul', () => {
  it('awards points to the opponent, switches turn, resets break (no rollback)', () => {
    const f = play(initialFrameState(1, 0), pot('red'), { type: 'foul', points: 4 });
    expect(f.scores).toEqual([1, 4]); // striker keeps the red; opponent gets 4
    expect(f.striker).toBe(1);
    expect(f.currentBreak).toEqual({ striker: 1, points: 0 });
  });
});

describe('phase transition reds → colors', () => {
  function clearReds(): FrameState {
    let f = initialFrameState(1, 0);
    for (let i = 0; i < 15; i++) f = applyScoringAction(f, pot('red'));
    return f; // 15 reds potted, redsRemaining 0, still reds phase
  }

  it('the free colour after the last red starts the colour sequence at yellow', () => {
    const f = applyScoringAction(clearReds(), pot('black')); // free colour
    expect(f.phase).toBe('colors');
    expect(f.colorOn).toBe('yellow');
    expect(f.scores).toEqual([22, 0]); // 15 reds + 7
    expect(f.pointsRemaining).toBe(27);
  });

  it('enforces the colour order and clears the table on the final black', () => {
    let f = applyScoringAction(clearReds(), pot('yellow')); // free colour → colorOn yellow
    // wrong colour next
    expect(() => applyScoringAction(f, pot('black'))).toThrow(EngineError);
    for (const c of ['yellow', 'green', 'brown', 'blue', 'pink', 'black'] as const) {
      f = applyScoringAction(f, pot(c));
    }
    expect(f.colorOn).toBeUndefined();
    expect(f.pointsRemaining).toBe(0);
    expect(f.status).toBe('in_progress'); // completion is detected at the match level
  });
});

describe('free ball', () => {
  const foul4: FrameAction = { type: 'foul', points: 4 };
  const freeBall: FrameAction = { type: 'freeBall' };

  it('is unavailable on a fresh frame', () => {
    expect(initialFrameState(1, 0).freeBallAvailable).toBe(false);
    expect(() => applyScoringAction(initialFrameState(1, 0), freeBall)).toThrow(EngineError);
  });

  it('is offered after a foul and, in the reds phase, scores 1 without removing a red', () => {
    const afterFoul = applyScoringAction(initialFrameState(1, 0), foul4);
    expect(afterFoul.freeBallAvailable).toBe(true);
    expect(afterFoul.striker).toBe(1); // foul passed the turn

    const f = applyScoringAction(afterFoul, freeBall);
    expect(f.scores).toEqual([0, 5]); // 4 (foul) + 1 (free ball as a red), to slot 1
    expect(f.redsRemaining).toBe(15); // no red removed
    expect(f.phase).toBe('reds');
    expect(f.currentBreak).toEqual({ striker: 1, points: 1 });
    expect(f.freeBallAvailable).toBe(false); // consumed
  });

  it('in the colours phase scores the value of colorOn without advancing the sequence', () => {
    let f = initialFrameState(1, 0);
    for (let i = 0; i < 15; i++) f = applyScoringAction(f, pot('red'));
    f = applyScoringAction(f, pot('yellow')); // free colour → colors phase, colorOn yellow
    f = applyScoringAction(f, foul4); // offer free ball, turn → slot 1
    expect(f.colorOn).toBe('yellow');

    const before = f.scores[1];
    const g = applyScoringAction(f, freeBall);
    expect(g.scores[1]).toBe(before + 2); // yellow = 2
    expect(g.colorOn).toBe('yellow'); // sequence unchanged
    expect(g.freeBallAvailable).toBe(false);
  });

  it('a normal pot clears the offer (no free ball afterwards)', () => {
    let f = applyScoringAction(initialFrameState(1, 0), foul4); // offer
    f = applyScoringAction(f, pot('red')); // striker 1 pots a red → offer cleared
    expect(f.freeBallAvailable).toBe(false);
    expect(() => applyScoringAction(f, freeBall)).toThrow(EngineError);
  });

  it('does not regress legal multi-ball-of-same-value potting (two reds = +2, not a foul)', () => {
    const f = play(initialFrameState(1, 0), pot('red'), pot('red'));
    expect(f.scores).toEqual([2, 0]);
    expect(f.redsRemaining).toBe(13);
    expect(f.currentBreak.points).toBe(2);
  });
});
