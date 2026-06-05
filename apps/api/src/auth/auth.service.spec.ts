import { describe, it, expect, vi, beforeEach } from 'vitest';
import { JwtService } from '@nestjs/jwt';
import { Prisma, type User as PrismaUser } from '@prisma/client';
import * as argon2 from 'argon2';
import { AuthService } from './auth.service';
import { ApiError } from '../common/api-error';
import { PrismaService } from '../prisma/prisma.service';

function fakeUser(overrides: Partial<PrismaUser> = {}): PrismaUser {
  return {
    id: 'u1',
    handle: 'ivan',
    displayName: 'Иван',
    email: 'ivan@mail.com',
    passwordHash: 'hash',
    createdAt: new Date('2026-06-05T10:00:00.000Z'),
    ...overrides,
  };
}

function uniqueError(target: string[]): Prisma.PrismaClientKnownRequestError {
  return new Prisma.PrismaClientKnownRequestError('Unique constraint failed', {
    code: 'P2002',
    clientVersion: 'test',
    meta: { target },
  });
}

const validRegister = {
  email: 'ivan@mail.com',
  password: 'supersecret',
  displayName: 'Иван',
  handle: 'ivan',
};

let prisma: { user: { create: ReturnType<typeof vi.fn>; findUnique: ReturnType<typeof vi.fn> } };
let service: AuthService;

beforeEach(() => {
  prisma = { user: { create: vi.fn(), findUnique: vi.fn() } };
  const jwt = new JwtService({ secret: 'test-secret', signOptions: { expiresIn: '30d' } });
  service = new AuthService(prisma as unknown as PrismaService, jwt);
});

describe('AuthService.register', () => {
  it('hashes the password, persists the user, and returns a token', async () => {
    prisma.user.create.mockResolvedValue(fakeUser());
    const res = await service.register(validRegister);

    expect(res.token).toBeTypeOf('string');
    expect(res.token.length).toBeGreaterThan(0);
    expect(res.user).toEqual({
      id: 'u1',
      handle: 'ivan',
      displayName: 'Иван',
      email: 'ivan@mail.com',
      createdAt: '2026-06-05T10:00:00.000Z',
    });

    const data = prisma.user.create.mock.calls[0]![0].data as { passwordHash: string };
    expect(data.passwordHash).not.toBe(validRegister.password);
    expect(await argon2.verify(data.passwordHash, validRegister.password)).toBe(true);
  });

  it('maps a duplicate email to 409 email_taken', async () => {
    prisma.user.create.mockRejectedValue(uniqueError(['email']));
    const err = await service.register(validRegister).catch((e) => e);
    expect(err).toBeInstanceOf(ApiError);
    expect(err.getStatus()).toBe(409);
    expect(err.getResponse()).toEqual({
      error: { code: 'email_taken', message: expect.any(String) },
    });
  });

  it('maps a duplicate handle to 409 handle_taken', async () => {
    prisma.user.create.mockRejectedValue(uniqueError(['handle']));
    const err = await service.register(validRegister).catch((e) => e);
    expect(err).toBeInstanceOf(ApiError);
    expect(err.getStatus()).toBe(409);
    expect(err.getResponse()).toEqual({
      error: { code: 'handle_taken', message: expect.any(String) },
    });
  });
});

describe('AuthService.login', () => {
  it('returns a token for valid credentials', async () => {
    const passwordHash = await argon2.hash('supersecret', { type: argon2.argon2id });
    prisma.user.findUnique.mockResolvedValue(fakeUser({ passwordHash }));

    const res = await service.login({ email: 'ivan@mail.com', password: 'supersecret' });
    expect(res.token).toBeTypeOf('string');
    expect(res.user.email).toBe('ivan@mail.com');
  });

  it('rejects an unknown email with 401 invalid_credentials', async () => {
    prisma.user.findUnique.mockResolvedValue(null);
    const err = await service.login({ email: 'nope@mail.com', password: 'x' }).catch((e) => e);
    expect(err).toBeInstanceOf(ApiError);
    expect(err.getStatus()).toBe(401);
    expect(err.getResponse()).toEqual({
      error: { code: 'invalid_credentials', message: expect.any(String) },
    });
  });

  it('rejects a wrong password with 401 invalid_credentials', async () => {
    const passwordHash = await argon2.hash('supersecret', { type: argon2.argon2id });
    prisma.user.findUnique.mockResolvedValue(fakeUser({ passwordHash }));
    const err = await service.login({ email: 'ivan@mail.com', password: 'wrong' }).catch((e) => e);
    expect(err).toBeInstanceOf(ApiError);
    expect(err.getStatus()).toBe(401);
  });
});
