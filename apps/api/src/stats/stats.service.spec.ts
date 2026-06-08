import { describe, it, expect, vi, beforeEach } from 'vitest';
import { StatsService } from './stats.service';
import { PrismaService } from '../prisma/prisma.service';
import { ApiError } from '../common/api-error';

const ev = (type: string, payload: Record<string, unknown> = {}) => ({ type, payload });

function user(id: string, handle: string) {
  return { id, handle, displayName: handle, email: `${handle}@m.com`, passwordHash: 'h', createdAt: new Date() };
}

/** A completed match where slot 0 = `me`, with an 8 break (red+black) by slot 0. */
function fakeMatch(over: Partial<Record<string, unknown>> = {}) {
  return {
    id: 'm1',
    ownerId: 'me',
    bestOf: 3,
    status: 'completed',
    framesWonA: 2,
    framesWonB: 1,
    winnerSlot: 0,
    selfScoringDisabled: false,
    firstBreakerSlot: 0,
    activeScorerUserId: null,
    createdAt: new Date('2026-06-01T10:00:00.000Z'),
    completedAt: new Date('2026-06-02T10:00:00.000Z'),
    participants: [
      { matchId: 'm1', slot: 0, userId: 'me', guestName: null, user: user('me', 'ivan') },
      { matchId: 'm1', slot: 1, userId: 'opp', guestName: null, user: user('opp', 'oleg') },
    ],
    events: [ev('pot', { ball: 'red' }), ev('pot', { ball: 'black' })],
    ...over,
  };
}

type PrismaMock = {
  user: { findUnique: ReturnType<typeof vi.fn> };
  friendship: { findFirst: ReturnType<typeof vi.fn> };
  match: { findMany: ReturnType<typeof vi.fn> };
};

let prisma: PrismaMock;
let service: StatsService;

beforeEach(() => {
  prisma = {
    user: { findUnique: vi.fn().mockResolvedValue(user('target', 'target')) },
    friendship: { findFirst: vi.fn() },
    match: { findMany: vi.fn().mockResolvedValue([]) },
  };
  service = new StatsService(prisma as unknown as PrismaService);
});

describe('StatsService.forUser — aggregation', () => {
  it('computes wins/losses/frames/winRate/highest break/top breaks (own stats)', async () => {
    prisma.match.findMany.mockResolvedValue([fakeMatch()]);

    const s = await service.forUser('me', 'me');

    expect(s).toMatchObject({
      userId: 'me',
      matchesPlayed: 1,
      wins: 1,
      losses: 0,
      winRate: 1,
      framesWon: 2,
      framesLost: 1,
      highestBreak: 8,
    });
    expect(s.topBreaks).toHaveLength(1);
    expect(s.topBreaks[0]).toMatchObject({
      value: 8,
      matchId: 'm1',
      opponent: { kind: 'user', userId: 'opp' },
      playedAt: '2026-06-02T10:00:00.000Z',
    });
  });

  it('counts a loss and the user’s own break from slot 1', async () => {
    // me is slot 1 here; slot 0 (opp) won. me made the 8 break.
    const m = fakeMatch({
      framesWonA: 2,
      framesWonB: 0,
      winnerSlot: 0,
      participants: [
        { matchId: 'm1', slot: 0, userId: 'opp', guestName: null, user: user('opp', 'oleg') },
        { matchId: 'm1', slot: 1, userId: 'me', guestName: null, user: user('me', 'ivan') },
      ],
      // events: slot 0 breaks first; pass to slot 1 (me), who makes red+black.
      events: [ev('endVisit'), ev('pot', { ball: 'red' }), ev('pot', { ball: 'black' })],
    });
    prisma.match.findMany.mockResolvedValue([m]);

    const s = await service.forUser('me', 'me');
    expect(s).toMatchObject({ wins: 0, losses: 1, framesWon: 0, framesLost: 2, highestBreak: 8 });
    expect(s.topBreaks[0]!.opponent).toMatchObject({ kind: 'user', userId: 'opp' });
  });

  it('returns zeros and no breaks when there are no matches', async () => {
    const s = await service.forUser('me', 'me');
    expect(s).toMatchObject({ matchesPlayed: 0, wins: 0, losses: 0, winRate: 0, highestBreak: 0 });
    expect(s.topBreaks).toEqual([]);
  });

  it('orders top breaks by value, descending', async () => {
    const small = fakeMatch({ id: 'm2', events: [ev('pot', { ball: 'red' })] }); // break 1
    const big = fakeMatch({ id: 'm3' }); // break 8
    prisma.match.findMany.mockResolvedValue([small, big]);

    const s = await service.forUser('me', 'me');
    expect(s.topBreaks.map((b) => b.value)).toEqual([8, 1]);
    expect(s.highestBreak).toBe(8);
  });
});

describe('StatsService.forUser — access control', () => {
  it('404 when the target user does not exist', async () => {
    prisma.user.findUnique.mockResolvedValue(null);
    const err = await service.forUser('ghost', 'me').catch((e) => e);
    expect(err).toBeInstanceOf(ApiError);
    expect(err.getStatus()).toBe(404);
  });

  it('allows viewing a friend’s stats', async () => {
    prisma.friendship.findFirst.mockResolvedValue({ id: 'f1' });
    const s = await service.forUser('target', 'me');
    expect(s.userId).toBe('target');
  });

  it('403 not_friends for a non-friend', async () => {
    prisma.friendship.findFirst.mockResolvedValue(null);
    const err = await service.forUser('target', 'me').catch((e) => e);
    expect(err.getStatus()).toBe(403);
    expect(err.getResponse().error.code).toBe('not_friends');
  });

  it('does not require friendship for your own stats', async () => {
    await service.forUser('me', 'me');
    expect(prisma.friendship.findFirst).not.toHaveBeenCalled();
  });
});
