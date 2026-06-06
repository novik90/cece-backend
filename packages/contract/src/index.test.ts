import { describe, it, expect } from 'vitest';
import {
  CONTRACT_VERSION,
  bestOfSchema,
  handleSchema,
  registerRequestSchema,
  participantSchema,
  opponentSchema,
  matchSchema,
  matchListQuerySchema,
  createMatchRequestSchema,
  errorResponseSchema,
} from './index';

describe('@cece/contract', () => {
  it('exposes the API version', () => {
    expect(CONTRACT_VERSION).toBe('v1');
  });
});

describe('bestOfSchema', () => {
  it('accepts odd values in 1..35', () => {
    for (const n of [1, 3, 5, 35]) expect(bestOfSchema.safeParse(n).success).toBe(true);
  });
  it('rejects even, out-of-range, and non-integers', () => {
    for (const n of [2, 0, 36, 37, 2.5]) expect(bestOfSchema.safeParse(n).success).toBe(false);
  });
});

describe('handleSchema', () => {
  it.each(['ivan', 'ivan_90', 'a1b'])('accepts %s', (h) => {
    expect(handleSchema.safeParse(h).success).toBe(true);
  });
  it.each(['Ivan', '9ivan', 'iv', 'ivan-90', 'привет', 'a'.repeat(21)])('rejects %s', (h) => {
    expect(handleSchema.safeParse(h).success).toBe(false);
  });
});

describe('registerRequestSchema', () => {
  it('accepts a valid body', () => {
    const r = registerRequestSchema.safeParse({
      email: 'ivan@mail.com',
      password: 'supersecret',
      displayName: 'Иван',
      handle: 'ivan',
    });
    expect(r.success).toBe(true);
  });
  it('rejects a weak password', () => {
    const r = registerRequestSchema.safeParse({
      email: 'ivan@mail.com',
      password: 'short',
      displayName: 'Иван',
      handle: 'ivan',
    });
    expect(r.success).toBe(false);
  });
});

describe('participantSchema', () => {
  it('accepts a user participant', () => {
    expect(
      participantSchema.safeParse({
        kind: 'user',
        userId: 'u1',
        handle: 'ivan',
        displayName: 'Иван',
      }).success,
    ).toBe(true);
  });
  it('accepts a guest participant', () => {
    expect(participantSchema.safeParse({ kind: 'guest', name: 'Гость' }).success).toBe(true);
  });
  it('rejects an unknown kind', () => {
    expect(participantSchema.safeParse({ kind: 'robot' }).success).toBe(false);
  });
});

describe('opponentSchema', () => {
  it('accepts a userId opponent', () => {
    expect(opponentSchema.safeParse({ userId: 'u1' }).success).toBe(true);
  });
  it('accepts a guestName opponent', () => {
    expect(opponentSchema.safeParse({ guestName: 'Гость' }).success).toBe(true);
  });
  it('rejects providing both at once', () => {
    expect(opponentSchema.safeParse({ userId: 'u1', guestName: 'Гость' }).success).toBe(false);
  });
  it('rejects an empty opponent', () => {
    expect(opponentSchema.safeParse({}).success).toBe(false);
  });
});

describe('matchSchema', () => {
  it('parses a freshly created match', () => {
    const match = {
      id: 'm1',
      ownerId: 'u1',
      participants: [
        { kind: 'user', userId: 'u1', handle: 'ivan', displayName: 'Иван' },
        { kind: 'guest', name: 'Гость' },
      ],
      bestOf: 5,
      status: 'scheduled',
      framesWon: [0, 0],
      createdAt: '2026-06-05T10:00:00.000Z',
    };
    expect(matchSchema.safeParse(match).success).toBe(true);
  });
});

describe('matchListQuerySchema', () => {
  it('defaults status to "all"', () => {
    const r = matchListQuerySchema.parse({});
    expect(r.status).toBe('all');
  });
});

describe('createMatchRequestSchema', () => {
  it('defaults selfScoringDisabled=false and firstBreaker=0', () => {
    const r = createMatchRequestSchema.parse({ opponent: { guestName: 'Гость' }, bestOf: 5 });
    expect(r.selfScoringDisabled).toBe(false);
    expect(r.firstBreaker).toBe(0);
  });
  it('accepts selfScoringDisabled + firstBreaker against a user', () => {
    const r = createMatchRequestSchema.safeParse({
      opponent: { userId: 'u2' },
      bestOf: 5,
      selfScoringDisabled: true,
      firstBreaker: 1,
    });
    expect(r.success).toBe(true);
  });
  it('rejects selfScoringDisabled for a guest opponent', () => {
    const r = createMatchRequestSchema.safeParse({
      opponent: { guestName: 'Гость' },
      bestOf: 5,
      selfScoringDisabled: true,
    });
    expect(r.success).toBe(false);
  });
  it('rejects an out-of-range firstBreaker', () => {
    const r = createMatchRequestSchema.safeParse({
      opponent: { guestName: 'Гость' },
      bestOf: 5,
      firstBreaker: 2,
    });
    expect(r.success).toBe(false);
  });
});

describe('errorResponseSchema', () => {
  it('validates the error envelope', () => {
    expect(
      errorResponseSchema.safeParse({ error: { code: 'validation_error', message: 'bad' } })
        .success,
    ).toBe(true);
  });
});
