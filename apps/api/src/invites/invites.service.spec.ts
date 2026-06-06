import { describe, it, expect, vi, beforeEach } from 'vitest';
import type { User as PrismaUser } from '@prisma/client';
import type { CreateMatchInvite } from '@cece/contract';
import { InvitesService } from './invites.service';
import { PrismaService } from '../prisma/prisma.service';
import { ApiError } from '../common/api-error';

function fakeUser(over: Partial<PrismaUser> = {}): PrismaUser {
  return {
    id: 'u1',
    handle: 'ivan',
    displayName: 'Иван',
    email: 'ivan@mail.com',
    passwordHash: 'hash',
    createdAt: new Date('2026-06-07T10:00:00.000Z'),
    ...over,
  };
}

const HOUR = 60 * 60 * 1000;

function fakeInvite(over: Partial<Record<string, unknown>> = {}) {
  return {
    id: 'inv1',
    fromUserId: 'me',
    toUserId: 'u2',
    bestOf: 5,
    selfScoringDisabled: false,
    firstBreakerSlot: 0,
    status: 'pending',
    matchId: null,
    createdAt: new Date('2026-06-07T10:00:00.000Z'),
    expiresAt: new Date(Date.now() + 24 * HOUR),
    from: fakeUser({ id: 'me', handle: 'ivan', displayName: 'Иван' }),
    to: fakeUser({ id: 'u2', handle: 'masha', displayName: 'Маша' }),
    ...over,
  };
}

const createReq = (o: Partial<CreateMatchInvite> = {}): CreateMatchInvite => ({
  userId: 'u2',
  bestOf: 5,
  selfScoringDisabled: false,
  firstBreaker: 0,
  ...o,
});

type PrismaMock = {
  user: { findUnique: ReturnType<typeof vi.fn> };
  match: { create: ReturnType<typeof vi.fn> };
  matchInvite: {
    create: ReturnType<typeof vi.fn>;
    findUnique: ReturnType<typeof vi.fn>;
    findMany: ReturnType<typeof vi.fn>;
    update: ReturnType<typeof vi.fn>;
  };
  $transaction: ReturnType<typeof vi.fn>;
};

let prisma: PrismaMock;
let service: InvitesService;

beforeEach(() => {
  prisma = {
    user: { findUnique: vi.fn() },
    match: { create: vi.fn() },
    matchInvite: {
      create: vi.fn(),
      findUnique: vi.fn(),
      findMany: vi.fn(),
      update: vi.fn(),
    },
    $transaction: vi.fn((cb: (tx: PrismaMock) => unknown) => cb(prisma)),
  };
  service = new InvitesService(prisma as unknown as PrismaService);
});

describe('InvitesService.create (I1)', () => {
  it('rejects inviting yourself with 422', async () => {
    const err = await service.create('me', createReq({ userId: 'me' })).catch((e) => e);
    expect(err).toBeInstanceOf(ApiError);
    expect(err.getStatus()).toBe(422);
    expect(prisma.matchInvite.create).not.toHaveBeenCalled();
  });

  it('returns 404 when the target does not exist', async () => {
    prisma.user.findUnique.mockResolvedValue(null);
    const err = await service.create('me', createReq()).catch((e) => e);
    expect(err.getStatus()).toBe(404);
  });

  it('creates a pending invite with a 24h expiry and the chosen options', async () => {
    prisma.user.findUnique.mockResolvedValue(fakeUser({ id: 'u2' }));
    prisma.matchInvite.create.mockResolvedValue(
      fakeInvite({ bestOf: 3, selfScoringDisabled: true, firstBreakerSlot: 1 }),
    );

    const res = await service.create('me', createReq({ bestOf: 3, selfScoringDisabled: true, firstBreaker: 1 }));

    const data = prisma.matchInvite.create.mock.calls[0]![0].data;
    expect(data.fromUserId).toBe('me');
    expect(data.toUserId).toBe('u2');
    expect(data.firstBreakerSlot).toBe(1);
    expect(data.expiresAt.getTime()).toBeGreaterThan(Date.now() + 23 * HOUR);
    expect(res).toMatchObject({
      status: 'pending',
      from: { id: 'me' },
      to: { id: 'u2' },
      bestOf: 3,
      selfScoringDisabled: true,
      firstBreaker: 1,
    });
  });
});

describe('InvitesService.list (I2)', () => {
  it('lists incoming invites (where toUserId = me), newest first', async () => {
    prisma.matchInvite.findMany.mockResolvedValue([fakeInvite({ toUserId: 'me' })]);
    await service.list('me', 'incoming');
    const args = prisma.matchInvite.findMany.mock.calls[0]![0];
    expect(args.where).toEqual({ toUserId: 'me' });
    expect(args.orderBy).toEqual({ createdAt: 'desc' });
  });

  it('lists outgoing invites (where fromUserId = me)', async () => {
    prisma.matchInvite.findMany.mockResolvedValue([fakeInvite()]);
    await service.list('me', 'outgoing');
    expect(prisma.matchInvite.findMany.mock.calls[0]![0].where).toEqual({ fromUserId: 'me' });
  });

  it('reports a past-due pending invite as expired and filters by it', async () => {
    prisma.matchInvite.findMany.mockResolvedValue([
      fakeInvite({ id: 'old', expiresAt: new Date(Date.now() - HOUR) }),
      fakeInvite({ id: 'fresh' }),
    ]);
    const res = await service.list('me', 'outgoing', 'expired');
    expect(res.invites.map((i) => i.id)).toEqual(['old']);
    expect(res.invites[0]!.status).toBe('expired');
  });
});

describe('InvitesService.accept (I3)', () => {
  const acceptedMatch = {
    id: 'm1',
    ownerId: 'me',
    bestOf: 5,
    status: 'scheduled',
    framesWonA: 0,
    framesWonB: 0,
    winnerSlot: null,
    activeScorerUserId: null,
    createdAt: new Date('2026-06-07T10:00:00.000Z'),
    completedAt: null,
    participants: [
      { matchId: 'm1', slot: 0, userId: 'me', guestName: null, user: fakeUser({ id: 'me', handle: 'ivan' }) },
      { matchId: 'm1', slot: 1, userId: 'u2', guestName: null, user: fakeUser({ id: 'u2', handle: 'masha' }) },
    ],
  };

  it('creates the match and links it to the invite', async () => {
    prisma.matchInvite.findUnique.mockResolvedValue(fakeInvite({ toUserId: 'u2' }));
    prisma.match.create.mockResolvedValue(acceptedMatch);

    const res = await service.accept('u2', 'inv1');

    const data = prisma.match.create.mock.calls[0]![0].data;
    expect(data.ownerId).toBe('me');
    expect(data.participants.create).toEqual([
      { slot: 0, userId: 'me' },
      { slot: 1, userId: 'u2' },
    ]);
    expect(prisma.matchInvite.update).toHaveBeenCalledWith(
      expect.objectContaining({ data: expect.objectContaining({ status: 'accepted', matchId: 'm1' }) }),
    );
    expect(res.id).toBe('m1');
  });

  it('404 when missing', async () => {
    prisma.matchInvite.findUnique.mockResolvedValue(null);
    const err = await service.accept('u2', 'nope').catch((e) => e);
    expect(err.getResponse().error.code).toBe('invite_not_found');
  });

  it('403 when I am not the invitee', async () => {
    prisma.matchInvite.findUnique.mockResolvedValue(fakeInvite({ toUserId: 'someone-else' }));
    const err = await service.accept('u2', 'inv1').catch((e) => e);
    expect(err.getStatus()).toBe(403);
    expect(err.getResponse().error.code).toBe('forbidden');
  });

  it('409 invite_not_pending when already accepted', async () => {
    prisma.matchInvite.findUnique.mockResolvedValue(fakeInvite({ toUserId: 'u2', status: 'accepted' }));
    const err = await service.accept('u2', 'inv1').catch((e) => e);
    expect(err.getResponse().error.code).toBe('invite_not_pending');
  });

  it('409 invite_expired when past expiry', async () => {
    prisma.matchInvite.findUnique.mockResolvedValue(
      fakeInvite({ toUserId: 'u2', expiresAt: new Date(Date.now() - HOUR) }),
    );
    const err = await service.accept('u2', 'inv1').catch((e) => e);
    expect(err.getStatus()).toBe(409);
    expect(err.getResponse().error.code).toBe('invite_expired');
    expect(prisma.match.create).not.toHaveBeenCalled();
  });
});

describe('InvitesService.decline (I4)', () => {
  it('marks the invite declined (invitee only)', async () => {
    prisma.matchInvite.findUnique.mockResolvedValue(fakeInvite({ toUserId: 'u2' }));
    const res = await service.decline('u2', 'inv1');
    expect(res).toEqual({ ok: true });
    expect(prisma.matchInvite.update).toHaveBeenCalledWith(
      expect.objectContaining({ data: expect.objectContaining({ status: 'declined' }) }),
    );
  });

  it('403 when a non-invitee tries to decline', async () => {
    prisma.matchInvite.findUnique.mockResolvedValue(fakeInvite({ toUserId: 'u2' }));
    const err = await service.decline('me', 'inv1').catch((e) => e);
    expect(err.getStatus()).toBe(403);
  });
});

describe('InvitesService.cancel (I5)', () => {
  it('marks the invite cancelled (sender only)', async () => {
    prisma.matchInvite.findUnique.mockResolvedValue(fakeInvite({ fromUserId: 'me' }));
    const res = await service.cancel('me', 'inv1');
    expect(res).toEqual({ ok: true });
    expect(prisma.matchInvite.update).toHaveBeenCalledWith(
      expect.objectContaining({ data: expect.objectContaining({ status: 'cancelled' }) }),
    );
  });

  it('403 when a non-sender tries to cancel', async () => {
    prisma.matchInvite.findUnique.mockResolvedValue(fakeInvite({ fromUserId: 'me' }));
    const err = await service.cancel('u2', 'inv1').catch((e) => e);
    expect(err.getStatus()).toBe(403);
  });
});
