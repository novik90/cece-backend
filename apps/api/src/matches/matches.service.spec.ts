import { describe, it, expect, vi, beforeEach } from 'vitest';
import { MatchesService } from './matches.service';
import { PrismaService } from '../prisma/prisma.service';
import { ApiError } from '../common/api-error';

type PrismaMock = {
  user: { findUnique: ReturnType<typeof vi.fn> };
  match: {
    create: ReturnType<typeof vi.fn>;
    findMany: ReturnType<typeof vi.fn>;
    findUnique: ReturnType<typeof vi.fn>;
  };
};

let prisma: PrismaMock;
let service: MatchesService;

beforeEach(() => {
  prisma = {
    user: { findUnique: vi.fn() },
    match: { create: vi.fn(), findMany: vi.fn(), findUnique: vi.fn() },
  };
  service = new MatchesService(prisma as unknown as PrismaService);
});

/** A persisted match row as returned with MATCH_INCLUDE. */
function fakeMatch(over: Partial<Record<string, unknown>> = {}) {
  return {
    id: 'm1',
    ownerId: 'me',
    bestOf: 5,
    status: 'scheduled',
    framesWonA: 0,
    framesWonB: 0,
    winnerSlot: null,
    activeScorerUserId: null,
    createdAt: new Date('2026-06-05T10:00:00.000Z'),
    completedAt: null,
    participants: [
      { matchId: 'm1', slot: 0, userId: 'me', guestName: null, user: { id: 'me', handle: 'ivan', displayName: 'Иван' } },
      { matchId: 'm1', slot: 1, userId: null, guestName: 'Гость', user: null },
    ],
    ...over,
  };
}

describe('MatchesService.create (C5)', () => {
  it('creates a match against a registered user (owner = slot 0)', async () => {
    prisma.user.findUnique.mockResolvedValue({ id: 'u2' });
    prisma.match.create.mockResolvedValue(
      fakeMatch({
        participants: [
          { matchId: 'm1', slot: 0, userId: 'me', guestName: null, user: { id: 'me', handle: 'ivan', displayName: 'Иван' } },
          { matchId: 'm1', slot: 1, userId: 'u2', guestName: null, user: { id: 'u2', handle: 'oleg', displayName: 'Олег' } },
        ],
      }),
    );

    const res = await service.create('me', { opponent: { userId: 'u2' }, bestOf: 5 });

    const data = prisma.match.create.mock.calls[0]![0].data;
    expect(data.ownerId).toBe('me');
    expect(data.participants.create).toEqual([
      { slot: 0, userId: 'me' },
      { slot: 1, userId: 'u2' },
    ]);
    expect(res.status).toBe('scheduled');
    expect(res.framesWon).toEqual([0, 0]);
    expect(res.participants[0]).toMatchObject({ kind: 'user', userId: 'me' });
    expect(res.participants[1]).toMatchObject({ kind: 'user', userId: 'u2' });
  });

  it('creates a match against a guest', async () => {
    prisma.match.create.mockResolvedValue(fakeMatch());

    const res = await service.create('me', { opponent: { guestName: 'Гость' }, bestOf: 5 });

    const data = prisma.match.create.mock.calls[0]![0].data;
    expect(data.participants.create[1]).toEqual({ slot: 1, guestName: 'Гость' });
    expect(prisma.user.findUnique).not.toHaveBeenCalled();
    expect(res.participants[1]).toEqual({ kind: 'guest', name: 'Гость' });
  });

  it('rejects playing against yourself with 422', async () => {
    const err = await service
      .create('me', { opponent: { userId: 'me' }, bestOf: 5 })
      .catch((e) => e);
    expect(err).toBeInstanceOf(ApiError);
    expect(err.getStatus()).toBe(422);
    expect(prisma.match.create).not.toHaveBeenCalled();
  });

  it('returns 404 user_not_found when the opponent does not exist', async () => {
    prisma.user.findUnique.mockResolvedValue(null);

    const err = await service.create('me', { opponent: { userId: 'ghost' }, bestOf: 5 }).catch((e) => e);
    expect(err).toBeInstanceOf(ApiError);
    expect(err.getStatus()).toBe(404);
    expect(prisma.match.create).not.toHaveBeenCalled();
  });
});

describe('MatchesService.list (C6)', () => {
  it('lists only my matches, newest first, with a status filter', async () => {
    prisma.match.findMany.mockResolvedValue([fakeMatch()]);

    await service.list('me', 'live');

    const args = prisma.match.findMany.mock.calls[0]![0];
    expect(args.where.participants).toEqual({ some: { userId: 'me' } });
    expect(args.where.status).toBe('live');
    expect(args.orderBy).toEqual({ createdAt: 'desc' });
  });

  it("omits the status filter for 'all'", async () => {
    prisma.match.findMany.mockResolvedValue([]);
    await service.list('me', 'all');
    const where = prisma.match.findMany.mock.calls[0]![0].where;
    expect(where.status).toBeUndefined();
  });
});

describe('MatchesService.get (C7)', () => {
  it('returns the match for a participant', async () => {
    prisma.match.findUnique.mockResolvedValue(fakeMatch());
    const res = await service.get('me', 'm1');
    expect(res.id).toBe('m1');
    expect(res.ownerId).toBe('me');
  });

  it('throws 404 match_not_found for a missing match', async () => {
    prisma.match.findUnique.mockResolvedValue(null);
    const err = await service.get('me', 'nope').catch((e) => e);
    expect(err).toBeInstanceOf(ApiError);
    expect(err.getStatus()).toBe(404);
  });

  it('throws 403 not_participant for a stranger', async () => {
    prisma.match.findUnique.mockResolvedValue(fakeMatch());
    const err = await service.get('stranger', 'm1').catch((e) => e);
    expect(err).toBeInstanceOf(ApiError);
    expect(err.getStatus()).toBe(403);
  });
});
