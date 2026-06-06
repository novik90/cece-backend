import { describe, it, expect, vi, beforeEach } from 'vitest';
import { MatchStateService } from './match-state.service';
import { PrismaService } from '../prisma/prisma.service';
import { ApiError } from '../common/api-error';

const userP = (id: string, slot: number, handle: string) => ({
  matchId: 'm1',
  slot,
  userId: id,
  guestName: null,
  user: { id, handle, displayName: handle },
});
const guestP = (slot: number, name: string) => ({
  matchId: 'm1',
  slot,
  userId: null,
  guestName: name,
  user: null,
});

/** Match loaded with participants (+users) and the event log. */
function fakeMatch(over: Partial<Record<string, unknown>> = {}) {
  return {
    id: 'm1',
    ownerId: 'u1',
    bestOf: 5,
    status: 'scheduled',
    framesWonA: 0,
    framesWonB: 0,
    winnerSlot: null,
    selfScoringDisabled: false,
    firstBreakerSlot: 0,
    activeScorerUserId: null,
    createdAt: new Date('2026-06-06T10:00:00.000Z'),
    completedAt: null,
    participants: [userP('u1', 0, 'ivan'), guestP(1, 'Гость')],
    events: [],
    ...over,
  };
}
const twoUserMatch = (over = {}) => fakeMatch({ participants: [userP('u1', 0, 'ivan'), userP('u2', 1, 'oleg')], ...over });

let tx: { match: { findUnique: ReturnType<typeof vi.fn>; update: ReturnType<typeof vi.fn> }; matchEvent: { create: ReturnType<typeof vi.fn> } };
let prisma: { match: { findUnique: ReturnType<typeof vi.fn> }; $transaction: ReturnType<typeof vi.fn> };
let service: MatchStateService;

beforeEach(() => {
  tx = {
    match: { findUnique: vi.fn(), update: vi.fn() },
    matchEvent: { create: vi.fn() },
  };
  prisma = {
    match: { findUnique: vi.fn() },
    $transaction: vi.fn(async (cb: (t: typeof tx) => unknown) => cb(tx)),
  };
  service = new MatchStateService(prisma as unknown as PrismaService);
});

describe('snapshot', () => {
  it('builds the initial live state for a participant', async () => {
    prisma.match.findUnique.mockResolvedValue(fakeMatch());
    const s = await service.snapshot('m1', 'u1');
    expect(s).toMatchObject({ status: 'scheduled', framesWon: [0, 0], version: 0 });
    expect(s.frame).toMatchObject({ frameNumber: 1, breaker: 0, redsRemaining: 15 });
    expect(s.participants[1]).toEqual({ kind: 'guest', name: 'Гость' });
  });

  it('folds the log (undo cancels the previous action) and counts version by all events', async () => {
    prisma.match.findUnique.mockResolvedValue(
      fakeMatch({
        events: [
          { type: 'pot', payload: { ball: 'red' } },
          { type: 'pot', payload: { ball: 'black' } },
          { type: 'undo', payload: {} },
        ],
      }),
    );
    const s = await service.snapshot('m1', 'u1');
    expect(s.frame?.scores).toEqual([1, 0]); // black undone, red kept
    expect(s.version).toBe(3); // all stored events count
  });

  it('throws 404 / 403', async () => {
    prisma.match.findUnique.mockResolvedValue(null);
    await expect(service.snapshot('x', 'u1')).rejects.toMatchObject({});
    prisma.match.findUnique.mockResolvedValue(fakeMatch());
    const err = await service.snapshot('m1', 'stranger').catch((e) => e);
    expect(err).toBeInstanceOf(ApiError);
    expect(err.getStatus()).toBe(403);
  });
});

describe('apply', () => {
  it('applies a pot: makes the match live, logs the event, updates the row', async () => {
    tx.match.findUnique.mockResolvedValue(fakeMatch());
    const s = await service.apply('m1', 'u1', { type: 'pot', ball: 'red' });

    expect(s.status).toBe('live');
    expect(s.version).toBe(1);
    expect(s.frame?.scores).toEqual([1, 0]);
    expect(tx.matchEvent.create).toHaveBeenCalledWith({
      data: { matchId: 'm1', seq: 0, type: 'pot', payload: { ball: 'red' }, byUserId: 'u1' },
    });
    expect(tx.match.update).toHaveBeenCalledWith({
      where: { id: 'm1' },
      data: expect.objectContaining({ status: 'live', framesWonA: 0, framesWonB: 0 }),
    });
  });

  it('forbids self-scoring when the actor is the striker and the option is on', async () => {
    tx.match.findUnique.mockResolvedValue(twoUserMatch({ selfScoringDisabled: true }));
    const err = await service.apply('m1', 'u1', { type: 'pot', ball: 'red' }).catch((e) => e);
    expect(err).toBeInstanceOf(ApiError);
    expect(err.getStatus()).toBe(403);
    expect(tx.matchEvent.create).not.toHaveBeenCalled();
  });

  it('lets the opponent score for the striker when self-scoring is disabled', async () => {
    tx.match.findUnique.mockResolvedValue(twoUserMatch({ selfScoringDisabled: true }));
    const s = await service.apply('m1', 'u2', { type: 'pot', ball: 'red' }); // u2 = slot 1, not striker
    expect(s.frame?.scores).toEqual([1, 0]); // points go to the striker (slot 0)
  });

  it('undo appends an undo event and reverts the state', async () => {
    tx.match.findUnique.mockResolvedValue(fakeMatch({ events: [{ type: 'pot', payload: { ball: 'red' } }] }));
    const s = await service.apply('m1', 'u1', { type: 'undo' });
    expect(tx.matchEvent.create).toHaveBeenCalledWith({
      data: { matchId: 'm1', seq: 1, type: 'undo', payload: {}, byUserId: 'u1' },
    });
    expect(s.frame?.scores).toEqual([0, 0]);
    expect(s.version).toBe(2);
  });

  it('rejects undo with an empty log (409) without writing', async () => {
    tx.match.findUnique.mockResolvedValue(fakeMatch({ events: [] }));
    const err = await service.apply('m1', 'u1', { type: 'undo' }).catch((e) => e);
    expect(err.getStatus()).toBe(409);
    expect(tx.matchEvent.create).not.toHaveBeenCalled();
  });

  it('rejects a non-participant (403) without writing', async () => {
    tx.match.findUnique.mockResolvedValue(fakeMatch());
    const err = await service.apply('m1', 'stranger', { type: 'pot', ball: 'red' }).catch((e) => e);
    expect(err.getStatus()).toBe(403);
    expect(tx.matchEvent.create).not.toHaveBeenCalled();
  });
});
