import { describe, it, expect } from 'vitest';
import {
  friendRequestSchema,
  createFriendRequestSchema,
  createFriendRequestResponseSchema,
  friendRequestListQuerySchema,
  acceptFriendRequestResponseSchema,
  friendListResponseSchema,
  matchInviteStatusSchema,
  matchInviteSchema,
  createMatchInviteSchema,
  matchInviteListQuerySchema,
  errorCodeSchema,
} from './index';

const publicUser = { id: 'u2', handle: 'masha', displayName: 'Маша' };

describe('friendRequestSchema', () => {
  it('parses an incoming request', () => {
    expect(
      friendRequestSchema.safeParse({
        id: 'fr1',
        user: publicUser,
        direction: 'incoming',
        createdAt: '2026-06-06T10:00:00.000Z',
      }).success,
    ).toBe(true);
  });
  it('rejects an unknown direction', () => {
    expect(
      friendRequestSchema.safeParse({
        id: 'fr1',
        user: publicUser,
        direction: 'sideways',
        createdAt: '2026-06-06T10:00:00.000Z',
      }).success,
    ).toBe(false);
  });
});

describe('createFriendRequestSchema', () => {
  it('accepts a userId and rejects extra fields', () => {
    expect(createFriendRequestSchema.safeParse({ userId: 'u2' }).success).toBe(true);
    expect(createFriendRequestSchema.safeParse({ userId: 'u2', note: 'hi' }).success).toBe(false);
  });
});

describe('createFriendRequestResponseSchema', () => {
  it('accepts the outgoing-request shape', () => {
    expect(
      createFriendRequestResponseSchema.safeParse({
        id: 'fr1',
        user: publicUser,
        direction: 'outgoing',
        createdAt: '2026-06-06T10:00:00.000Z',
      }).success,
    ).toBe(true);
  });
  it('accepts the befriended shape (counter-request)', () => {
    expect(
      createFriendRequestResponseSchema.safeParse({ befriended: true, friend: publicUser }).success,
    ).toBe(true);
  });
});

describe('friendRequestListQuerySchema', () => {
  it('defaults direction to incoming', () => {
    expect(friendRequestListQuerySchema.parse({}).direction).toBe('incoming');
  });
});

describe('accept / friend list responses', () => {
  it('accept returns a friend', () => {
    expect(acceptFriendRequestResponseSchema.safeParse({ friend: publicUser }).success).toBe(true);
  });
  it('friend list is an array of public users', () => {
    expect(friendListResponseSchema.safeParse({ friends: [publicUser] }).success).toBe(true);
  });
});

const invite = {
  id: 'inv1',
  from: { id: 'u1', handle: 'ivan', displayName: 'Иван' },
  to: publicUser,
  bestOf: 5,
  selfScoringDisabled: false,
  firstBreaker: 0,
  status: 'pending',
  createdAt: '2026-06-06T10:00:00.000Z',
  expiresAt: '2026-06-07T10:00:00.000Z',
} as const;

describe('matchInviteStatusSchema', () => {
  it('accepts the five lifecycle states', () => {
    for (const s of ['pending', 'accepted', 'declined', 'cancelled', 'expired']) {
      expect(matchInviteStatusSchema.safeParse(s).success).toBe(true);
    }
    expect(matchInviteStatusSchema.safeParse('frozen').success).toBe(false);
  });
});

describe('matchInviteSchema', () => {
  it('parses a pending invite', () => {
    expect(matchInviteSchema.safeParse(invite).success).toBe(true);
  });
  it('parses an accepted invite with matchId', () => {
    expect(
      matchInviteSchema.safeParse({ ...invite, status: 'accepted', matchId: 'm1' }).success,
    ).toBe(true);
  });
  it('rejects an even bestOf', () => {
    expect(matchInviteSchema.safeParse({ ...invite, bestOf: 4 }).success).toBe(false);
  });
  it('rejects firstBreaker outside {0,1}', () => {
    expect(matchInviteSchema.safeParse({ ...invite, firstBreaker: 2 }).success).toBe(false);
  });
});

describe('createMatchInviteSchema', () => {
  it('defaults selfScoringDisabled and firstBreaker', () => {
    const r = createMatchInviteSchema.parse({ userId: 'u2', bestOf: 5 });
    expect(r.selfScoringDisabled).toBe(false);
    expect(r.firstBreaker).toBe(0);
  });
  it('rejects extra fields and an even bestOf', () => {
    expect(createMatchInviteSchema.safeParse({ userId: 'u2', bestOf: 5, x: 1 }).success).toBe(false);
    expect(createMatchInviteSchema.safeParse({ userId: 'u2', bestOf: 4 }).success).toBe(false);
  });
});

describe('matchInviteListQuerySchema', () => {
  it('defaults direction to incoming and leaves status optional', () => {
    const r = matchInviteListQuerySchema.parse({});
    expect(r.direction).toBe('incoming');
    expect(r.status).toBeUndefined();
  });
});

describe('errorCodeSchema (Phase 3 codes)', () => {
  it.each([
    'already_friends',
    'friend_request_exists',
    'friend_request_not_found',
    'request_not_pending',
    'not_friends',
    'invite_not_found',
    'invite_not_pending',
    'invite_expired',
    'forbidden',
  ])('includes %s', (code) => {
    expect(errorCodeSchema.safeParse(code).success).toBe(true);
  });
});
