import { describe, it, expect, vi, beforeEach } from 'vitest';
import { MatchStateService } from './match-state.service';
import { PrismaService } from '../prisma/prisma.service';
import { ApiError } from '../common/api-error';

/** A match loaded with participants (+users) and its event log. */
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
    participants: [
      { matchId: 'm1', slot: 0, userId: 'u1', guestName: null, user: { id: 'u1', handle: 'ivan', displayName: 'Иван' } },
      { matchId: 'm1', slot: 1, userId: null, guestName: 'Гость', user: null },
    ],
    events: [],
    ...over,
  };
}

let prisma: { match: { findUnique: ReturnType<typeof vi.fn> } };
let service: MatchStateService;

beforeEach(() => {
  prisma = { match: { findUnique: vi.fn() } };
  service = new MatchStateService(prisma as unknown as PrismaService);
});

describe('MatchStateService.snapshot', () => {
  it('builds the initial live state for a participant of a fresh match', async () => {
    prisma.match.findUnique.mockResolvedValue(fakeMatch());

    const s = await service.snapshot('m1', 'u1');

    expect(s).toMatchObject({
      matchId: 'm1',
      status: 'scheduled',
      bestOf: 5,
      framesWon: [0, 0],
      selfScoringDisabled: false,
      version: 0,
    });
    expect(s.frame).toMatchObject({ frameNumber: 1, breaker: 0, redsRemaining: 15 });
    expect(s.participants[0]).toMatchObject({ kind: 'user', userId: 'u1' });
    expect(s.participants[1]).toEqual({ kind: 'guest', name: 'Гость' });
  });

  it('honours first_breaker_slot', async () => {
    prisma.match.findUnique.mockResolvedValue(fakeMatch({ firstBreakerSlot: 1 }));
    const s = await service.snapshot('m1', 'u1');
    expect(s.frame?.breaker).toBe(1);
    expect(s.frame?.striker).toBe(1);
  });

  it('folds the event log to rebuild the current state', async () => {
    prisma.match.findUnique.mockResolvedValue(
      fakeMatch({
        events: [
          { seq: 0, type: 'pot', payload: { ball: 'red' } },
          { seq: 1, type: 'pot', payload: { ball: 'black' } },
        ],
      }),
    );

    const s = await service.snapshot('m1', 'u1');

    expect(s.status).toBe('live'); // first action made it live
    expect(s.version).toBe(2);
    expect(s.frame?.scores).toEqual([8, 0]);
    expect(s.frame?.redsRemaining).toBe(14);
    expect(s.highestBreak).toEqual([8, 0]);
  });

  it('throws match_not_found when the match is missing', async () => {
    prisma.match.findUnique.mockResolvedValue(null);
    const err = await service.snapshot('nope', 'u1').catch((e) => e);
    expect(err).toBeInstanceOf(ApiError);
    expect(err.getStatus()).toBe(404);
  });

  it('throws not_participant for a stranger', async () => {
    prisma.match.findUnique.mockResolvedValue(fakeMatch());
    const err = await service.snapshot('m1', 'stranger').catch((e) => e);
    expect(err).toBeInstanceOf(ApiError);
    expect(err.getStatus()).toBe(403);
  });
});
