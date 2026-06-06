import { describe, it, expect, vi, beforeEach } from 'vitest';
import type { User as PrismaUser } from '@prisma/client';
import { FriendsService } from './friends.service';
import { PrismaService } from '../prisma/prisma.service';
import { ApiError } from '../common/api-error';

function fakeUser(over: Partial<PrismaUser> = {}): PrismaUser {
  return {
    id: 'u1',
    handle: 'ivan',
    displayName: 'Иван',
    email: 'ivan@mail.com',
    passwordHash: 'hash',
    createdAt: new Date('2026-06-06T10:00:00.000Z'),
    ...over,
  };
}

function fakeFriendship(over: Partial<Record<string, unknown>> = {}) {
  return {
    id: 'f1',
    requesterId: 'me',
    addresseeId: 'u2',
    status: 'pending',
    createdAt: new Date('2026-06-06T10:00:00.000Z'),
    respondedAt: null,
    requester: fakeUser({ id: 'me', handle: 'ivan', displayName: 'Иван' }),
    addressee: fakeUser({ id: 'u2', handle: 'masha', displayName: 'Маша' }),
    ...over,
  };
}

type PrismaMock = {
  user: { findUnique: ReturnType<typeof vi.fn> };
  friendship: {
    findFirst: ReturnType<typeof vi.fn>;
    findUnique: ReturnType<typeof vi.fn>;
    findMany: ReturnType<typeof vi.fn>;
    create: ReturnType<typeof vi.fn>;
    update: ReturnType<typeof vi.fn>;
    delete: ReturnType<typeof vi.fn>;
    deleteMany: ReturnType<typeof vi.fn>;
  };
};

let prisma: PrismaMock;
let service: FriendsService;

beforeEach(() => {
  prisma = {
    user: { findUnique: vi.fn() },
    friendship: {
      findFirst: vi.fn(),
      findUnique: vi.fn(),
      findMany: vi.fn(),
      create: vi.fn(),
      update: vi.fn(),
      delete: vi.fn(),
      deleteMany: vi.fn(),
    },
  };
  service = new FriendsService(prisma as unknown as PrismaService);
});

describe('FriendsService.sendRequest (F1)', () => {
  it('rejects befriending yourself with 422', async () => {
    const err = await service.sendRequest('me', 'me').catch((e) => e);
    expect(err).toBeInstanceOf(ApiError);
    expect(err.getStatus()).toBe(422);
    expect(prisma.user.findUnique).not.toHaveBeenCalled();
  });

  it('returns 404 when the target does not exist', async () => {
    prisma.user.findUnique.mockResolvedValue(null);
    const err = await service.sendRequest('me', 'ghost').catch((e) => e);
    expect(err.getStatus()).toBe(404);
  });

  it('creates a pending request and returns it as outgoing', async () => {
    prisma.user.findUnique.mockResolvedValue(fakeUser({ id: 'u2', handle: 'masha' }));
    prisma.friendship.findFirst.mockResolvedValue(null);
    prisma.friendship.create.mockResolvedValue(fakeFriendship());

    const res = await service.sendRequest('me', 'u2');

    expect(res).toEqual({
      id: 'f1',
      user: { id: 'u2', handle: 'masha', displayName: 'Маша' },
      direction: 'outgoing',
      createdAt: '2026-06-06T10:00:00.000Z',
    });
  });

  it('throws 409 already_friends when an accepted row exists', async () => {
    prisma.user.findUnique.mockResolvedValue(fakeUser({ id: 'u2' }));
    prisma.friendship.findFirst.mockResolvedValue(fakeFriendship({ status: 'accepted' }));
    const err = await service.sendRequest('me', 'u2').catch((e) => e);
    expect(err.getStatus()).toBe(409);
    expect(err.getResponse()).toEqual({
      error: { code: 'already_friends', message: expect.any(String) },
    });
  });

  it('throws 409 friend_request_exists when I already sent one', async () => {
    prisma.user.findUnique.mockResolvedValue(fakeUser({ id: 'u2' }));
    prisma.friendship.findFirst.mockResolvedValue(
      fakeFriendship({ status: 'pending', requesterId: 'me', addresseeId: 'u2' }),
    );
    const err = await service.sendRequest('me', 'u2').catch((e) => e);
    expect(err.getResponse().error.code).toBe('friend_request_exists');
  });

  it('auto-accepts a counter-request and reports befriended', async () => {
    const target = fakeUser({ id: 'u2', handle: 'masha', displayName: 'Маша' });
    prisma.user.findUnique.mockResolvedValue(target);
    prisma.friendship.findFirst.mockResolvedValue(
      fakeFriendship({ status: 'pending', requesterId: 'u2', addresseeId: 'me' }),
    );
    prisma.friendship.update.mockResolvedValue(fakeFriendship({ status: 'accepted' }));

    const res = await service.sendRequest('me', 'u2');

    expect(res).toEqual({
      befriended: true,
      friend: { id: 'u2', handle: 'masha', displayName: 'Маша' },
    });
    expect(prisma.friendship.update).toHaveBeenCalledWith(
      expect.objectContaining({ where: { id: 'f1' }, data: expect.objectContaining({ status: 'accepted' }) }),
    );
  });
});

describe('FriendsService.listRequests (F2)', () => {
  it('lists incoming pending requests (other party = requester)', async () => {
    prisma.friendship.findMany.mockResolvedValue([
      fakeFriendship({
        requesterId: 'u2',
        addresseeId: 'me',
        requester: fakeUser({ id: 'u2', handle: 'masha', displayName: 'Маша' }),
        addressee: fakeUser({ id: 'me', handle: 'ivan', displayName: 'Иван' }),
      }),
    ]);
    const res = await service.listRequests('me', 'incoming');

    const where = prisma.friendship.findMany.mock.calls[0]![0].where;
    expect(where).toEqual({ addresseeId: 'me', status: 'pending' });
    expect(res.requests[0]).toMatchObject({ direction: 'incoming', user: { id: 'u2' } });
  });

  it('lists outgoing pending requests (other party = addressee)', async () => {
    prisma.friendship.findMany.mockResolvedValue([fakeFriendship()]);
    const res = await service.listRequests('me', 'outgoing');
    const where = prisma.friendship.findMany.mock.calls[0]![0].where;
    expect(where).toEqual({ requesterId: 'me', status: 'pending' });
    expect(res.requests[0]).toMatchObject({ direction: 'outgoing', user: { id: 'u2' } });
  });
});

describe('FriendsService.accept (F3)', () => {
  it('accepts and returns the requester as friend', async () => {
    prisma.friendship.findUnique.mockResolvedValue(
      fakeFriendship({
        requesterId: 'u2',
        addresseeId: 'me',
        requester: fakeUser({ id: 'u2', handle: 'masha', displayName: 'Маша' }),
        addressee: fakeUser({ id: 'me', handle: 'ivan', displayName: 'Иван' }),
      }),
    );
    prisma.friendship.update.mockResolvedValue(fakeFriendship({ status: 'accepted' }));

    const res = await service.accept('me', 'f1');
    expect(res.friend).toEqual({ id: 'u2', handle: 'masha', displayName: 'Маша' });
  });

  it('404 when missing', async () => {
    prisma.friendship.findUnique.mockResolvedValue(null);
    const err = await service.accept('me', 'nope').catch((e) => e);
    expect(err.getResponse().error.code).toBe('friend_request_not_found');
  });

  it('403 when I am not the addressee', async () => {
    prisma.friendship.findUnique.mockResolvedValue(
      fakeFriendship({ requesterId: 'u2', addresseeId: 'someone-else' }),
    );
    const err = await service.accept('me', 'f1').catch((e) => e);
    expect(err.getStatus()).toBe(403);
    expect(err.getResponse().error.code).toBe('forbidden');
  });

  it('409 when not pending', async () => {
    prisma.friendship.findUnique.mockResolvedValue(
      fakeFriendship({ requesterId: 'u2', addresseeId: 'me', status: 'accepted' }),
    );
    const err = await service.accept('me', 'f1').catch((e) => e);
    expect(err.getResponse().error.code).toBe('request_not_pending');
  });
});

describe('FriendsService.decline (F4)', () => {
  it('deletes the pending request', async () => {
    prisma.friendship.findUnique.mockResolvedValue(
      fakeFriendship({ requesterId: 'u2', addresseeId: 'me' }),
    );
    prisma.friendship.delete.mockResolvedValue(fakeFriendship());
    const res = await service.decline('me', 'f1');
    expect(res).toEqual({ ok: true });
    expect(prisma.friendship.delete).toHaveBeenCalledWith({ where: { id: 'f1' } });
  });
});

describe('FriendsService.listFriends (F5)', () => {
  it('returns the other side of accepted rows, sorted by handle', async () => {
    prisma.friendship.findMany.mockResolvedValue([
      fakeFriendship({
        status: 'accepted',
        requesterId: 'me',
        addressee: fakeUser({ id: 'u3', handle: 'zoe', displayName: 'Зоя' }),
      }),
      fakeFriendship({
        status: 'accepted',
        requesterId: 'u2',
        addresseeId: 'me',
        requester: fakeUser({ id: 'u2', handle: 'anna', displayName: 'Аня' }),
      }),
    ]);
    const res = await service.listFriends('me');
    expect(res.friends.map((f) => f.handle)).toEqual(['anna', 'zoe']);
  });
});

describe('FriendsService.removeFriend (F6)', () => {
  it('removes an accepted friendship', async () => {
    prisma.friendship.deleteMany.mockResolvedValue({ count: 1 });
    await expect(service.removeFriend('me', 'u2')).resolves.toBeUndefined();
  });

  it('404 not_friends when nothing was removed', async () => {
    prisma.friendship.deleteMany.mockResolvedValue({ count: 0 });
    const err = await service.removeFriend('me', 'u2').catch((e) => e);
    expect(err.getStatus()).toBe(404);
    expect(err.getResponse().error.code).toBe('not_friends');
  });
});
