import { describe, it, expect, vi, beforeEach } from 'vitest';
import type { User as PrismaUser } from '@prisma/client';
import { UsersService } from './users.service';
import { PrismaService } from '../prisma/prisma.service';

function fakeUser(over: Partial<PrismaUser>): PrismaUser {
  return {
    id: 'u1',
    handle: 'ivan',
    displayName: 'Иван',
    email: 'ivan@mail.com',
    passwordHash: 'hash',
    createdAt: new Date('2026-06-05T10:00:00.000Z'),
    ...over,
  };
}

let prisma: { user: { findMany: ReturnType<typeof vi.fn> } };
let service: UsersService;

beforeEach(() => {
  prisma = { user: { findMany: vi.fn() } };
  service = new UsersService(prisma as unknown as PrismaService);
});

describe('UsersService.search', () => {
  it('returns public users (no email) matching the handle prefix', async () => {
    prisma.user.findMany.mockResolvedValue([
      fakeUser({ id: 'u2', handle: 'ivanka', displayName: 'Иванка' }),
    ]);

    const res = await service.search('iva', 'me');
    expect(res).toEqual({ users: [{ id: 'u2', handle: 'ivanka', displayName: 'Иванка' }] });
  });

  it('excludes the current user and does a case-insensitive prefix search', async () => {
    prisma.user.findMany.mockResolvedValue([]);
    await service.search('IVA', 'me');

    const where = prisma.user.findMany.mock.calls[0]![0].where;
    expect(where.id).toEqual({ not: 'me' });
    expect(where.handle).toEqual({ startsWith: 'IVA', mode: 'insensitive' });
  });
});
