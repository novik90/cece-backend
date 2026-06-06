import { randomUUID } from 'node:crypto';
import { Prisma } from '@prisma/client';

/**
 * In-memory stand-in for `PrismaService`, used by the e2e/contract tests so the
 * full HTTP stack (guard, validation pipe, filter, controllers, services) can be
 * exercised without a real Postgres. It implements only the query shapes the API
 * actually issues — see the call sites in auth/users/matches.
 */

interface UserRow {
  id: string;
  handle: string;
  displayName: string;
  email: string;
  passwordHash: string;
  createdAt: Date;
}

interface ParticipantRow {
  matchId: string;
  slot: number;
  userId: string | null;
  guestName: string | null;
}

type MatchStatus = 'scheduled' | 'live' | 'completed';

interface MatchRow {
  id: string;
  ownerId: string;
  bestOf: number;
  status: MatchStatus;
  framesWonA: number;
  framesWonB: number;
  winnerSlot: number | null;
  selfScoringDisabled: boolean;
  firstBreakerSlot: number;
  activeScorerUserId: string | null;
  createdAt: Date;
  completedAt: Date | null;
  seq: number;
}

interface EventRow {
  id: string;
  matchId: string;
  frameId: string | null;
  seq: number;
  type: string;
  payload: unknown;
  byUserId: string | null;
  createdAt: Date;
}

type LoadedParticipant = ParticipantRow & { user: UserRow | null };
type LoadedMatch = MatchRow & { participants: LoadedParticipant[]; events: EventRow[] };

type FriendshipStatus = 'pending' | 'accepted';

interface FriendshipRow {
  id: string;
  requesterId: string;
  addresseeId: string;
  status: FriendshipStatus;
  createdAt: Date;
  respondedAt: Date | null;
}

type MatchInviteStatus = 'pending' | 'accepted' | 'declined' | 'cancelled' | 'expired';

interface MatchInviteRow {
  id: string;
  fromUserId: string;
  toUserId: string;
  bestOf: number;
  selfScoringDisabled: boolean;
  firstBreakerSlot: number;
  status: MatchInviteStatus;
  matchId: string | null;
  createdAt: Date;
  expiresAt: Date;
  respondedAt: Date | null;
}

const CREATED_AT_BASE = Date.UTC(2026, 0, 1);

/**
 * Minimal Prisma `where` evaluator covering the shapes friends/invites use:
 * scalar equality, `{ in: [...] }`, `{ not: x }`, and `OR: [...]`. Enough for the
 * fake; not a general-purpose matcher.
 */
function whereMatch(row: object, where: Record<string, unknown>): boolean {
  const r = row as Record<string, unknown>;
  for (const [key, cond] of Object.entries(where)) {
    if (key === 'OR') {
      const clauses = cond as Array<Record<string, unknown>>;
      if (!clauses.some((c) => whereMatch(row, c))) return false;
      continue;
    }
    if (key === 'AND') {
      const clauses = cond as Array<Record<string, unknown>>;
      if (!clauses.every((c) => whereMatch(row, c))) return false;
      continue;
    }
    const value = r[key];
    if (cond !== null && typeof cond === 'object' && !(cond instanceof Date)) {
      const c = cond as Record<string, unknown>;
      if ('in' in c && !(c.in as unknown[]).includes(value)) return false;
      if ('not' in c && value === c.not) return false;
    } else if (value !== cond) {
      return false;
    }
  }
  return true;
}

/** Sort by a single `{ field: 'asc'|'desc' }` orderBy (createdAt in practice). */
function applyOrderBy<T extends object>(rows: T[], orderBy?: unknown): T[] {
  if (!orderBy || typeof orderBy !== 'object') return rows;
  const [field, dir] = Object.entries(orderBy as Record<string, 'asc' | 'desc'>)[0] ?? [];
  if (!field) return rows;
  return [...rows].sort((a, b) => {
    const av = (a as Record<string, unknown>)[field] as number | Date;
    const bv = (b as Record<string, unknown>)[field] as number | Date;
    const cmp = av < bv ? -1 : av > bv ? 1 : 0;
    return dir === 'desc' ? -cmp : cmp;
  });
}

function uniqueViolation(target: string): Prisma.PrismaClientKnownRequestError {
  return new Prisma.PrismaClientKnownRequestError('Unique constraint failed', {
    code: 'P2002',
    clientVersion: 'fake',
    meta: { target: [target] },
  });
}

export class FakePrisma {
  private readonly users: UserRow[] = [];
  private readonly matches: MatchRow[] = [];
  private readonly participants: ParticipantRow[] = [];
  private readonly events: EventRow[] = [];
  private readonly friendships: FriendshipRow[] = [];
  private readonly matchInvites: MatchInviteRow[] = [];
  private seq = 0;

  /** Run a callback "in a transaction" — the fake is its own tx client. */
  $transaction<T>(cb: (tx: this) => Promise<T>): Promise<T> {
    return cb(this);
  }

  readonly user = {
    create: (args: {
      data: { email: string; handle: string; displayName: string; passwordHash: string };
    }): Promise<UserRow> => {
      const { data } = args;
      if (this.users.some((u) => u.email === data.email)) throw uniqueViolation('email');
      if (this.users.some((u) => u.handle === data.handle)) throw uniqueViolation('handle');
      const row: UserRow = {
        id: randomUUID(),
        email: data.email,
        handle: data.handle,
        displayName: data.displayName,
        passwordHash: data.passwordHash,
        createdAt: new Date(CREATED_AT_BASE + this.seq++),
      };
      this.users.push(row);
      return Promise.resolve({ ...row });
    },

    findUnique: (args: {
      where: { id?: string; email?: string };
    }): Promise<UserRow | null> => {
      const { where } = args;
      const row = this.users.find(
        (u) =>
          (where.id !== undefined && u.id === where.id) ||
          (where.email !== undefined && u.email === where.email),
      );
      return Promise.resolve(row ? { ...row } : null);
    },

    findMany: (args: {
      where: { handle: { startsWith: string; mode?: string }; id?: { not: string } };
      orderBy?: unknown;
      take?: number;
    }): Promise<UserRow[]> => {
      const prefix = args.where.handle.startsWith.toLowerCase();
      const excludeId = args.where.id?.not;
      let rows = this.users
        .filter((u) => u.handle.toLowerCase().startsWith(prefix))
        .filter((u) => u.id !== excludeId)
        .sort((a, b) => a.handle.localeCompare(b.handle));
      if (args.take !== undefined) rows = rows.slice(0, args.take);
      return Promise.resolve(rows.map((u) => ({ ...u })));
    },
  };

  readonly match = {
    create: (args: {
      data: {
        ownerId: string;
        bestOf: number;
        selfScoringDisabled?: boolean;
        firstBreakerSlot?: number;
        participants: { create: Array<{ slot: number; userId?: string; guestName?: string }> };
      };
    }): Promise<LoadedMatch> => {
      const { data } = args;
      const row: MatchRow = {
        id: randomUUID(),
        ownerId: data.ownerId,
        bestOf: data.bestOf,
        status: 'scheduled',
        framesWonA: 0,
        framesWonB: 0,
        winnerSlot: null,
        selfScoringDisabled: data.selfScoringDisabled ?? false,
        firstBreakerSlot: data.firstBreakerSlot ?? 0,
        activeScorerUserId: null,
        createdAt: new Date(CREATED_AT_BASE + this.seq),
        completedAt: null,
        seq: this.seq++,
      };
      this.matches.push(row);
      for (const p of data.participants.create) {
        this.participants.push({
          matchId: row.id,
          slot: p.slot,
          userId: p.userId ?? null,
          guestName: p.guestName ?? null,
        });
      }
      return Promise.resolve(this.load(row));
    },

    update: (args: { where: { id: string }; data: Partial<MatchRow> }): Promise<LoadedMatch> => {
      const row = this.matches.find((m) => m.id === args.where.id);
      if (!row) throw new Error(`match ${args.where.id} not found`);
      Object.assign(row, args.data);
      return Promise.resolve(this.load(row));
    },

    findMany: (args: {
      where: { participants: { some: { userId: string } }; status?: MatchStatus };
      orderBy?: unknown;
      include?: unknown;
    }): Promise<LoadedMatch[]> => {
      const userId = args.where.participants.some.userId;
      const status = args.where.status;
      const rows = this.matches
        .filter((m) =>
          this.participants.some((p) => p.matchId === m.id && p.userId === userId),
        )
        .filter((m) => status === undefined || m.status === status)
        .sort((a, b) => b.seq - a.seq);
      return Promise.resolve(rows.map((m) => this.load(m)));
    },

    findUnique: (args: {
      where: { id: string };
      include?: unknown;
    }): Promise<LoadedMatch | null> => {
      const row = this.matches.find((m) => m.id === args.where.id);
      return Promise.resolve(row ? this.load(row) : null);
    },
  };

  readonly matchEvent = {
    create: (args: {
      data: {
        matchId: string;
        frameId?: string | null;
        seq: number;
        type: string;
        payload: unknown;
        byUserId?: string | null;
      };
    }): Promise<EventRow> => {
      const { data } = args;
      if (this.events.some((e) => e.matchId === data.matchId && e.seq === data.seq)) {
        throw uniqueViolation('match_id_seq');
      }
      const row: EventRow = {
        id: randomUUID(),
        matchId: data.matchId,
        frameId: data.frameId ?? null,
        seq: data.seq,
        type: data.type,
        payload: data.payload,
        byUserId: data.byUserId ?? null,
        createdAt: new Date(CREATED_AT_BASE + this.seq++),
      };
      this.events.push(row);
      return Promise.resolve({ ...row });
    },
  };

  readonly friendship = {
    create: (args: {
      data: {
        requesterId: string;
        addresseeId: string;
        status?: FriendshipStatus;
        respondedAt?: Date | null;
      };
      include?: unknown;
    }): Promise<unknown> => {
      const { data } = args;
      const dup = this.friendships.some(
        (f) => f.requesterId === data.requesterId && f.addresseeId === data.addresseeId,
      );
      if (dup) throw uniqueViolation('requester_id_addressee_id');
      const row: FriendshipRow = {
        id: randomUUID(),
        requesterId: data.requesterId,
        addresseeId: data.addresseeId,
        status: data.status ?? 'pending',
        createdAt: new Date(CREATED_AT_BASE + this.seq++),
        respondedAt: data.respondedAt ?? null,
      };
      this.friendships.push(row);
      return Promise.resolve(this.loadFriendship(row, args.include));
    },

    findFirst: (args: { where: Record<string, unknown>; include?: unknown }): Promise<unknown> => {
      const row = this.friendships.find((f) => whereMatch(f, args.where));
      return Promise.resolve(row ? this.loadFriendship(row, args.include) : null);
    },

    findUnique: (args: {
      where: {
        id?: string;
        requesterId_addresseeId?: { requesterId: string; addresseeId: string };
      };
      include?: unknown;
    }): Promise<unknown> => {
      const { where } = args;
      const row = this.friendships.find((f) => {
        if (where.id !== undefined) return f.id === where.id;
        const k = where.requesterId_addresseeId;
        return k !== undefined && f.requesterId === k.requesterId && f.addresseeId === k.addresseeId;
      });
      return Promise.resolve(row ? this.loadFriendship(row, args.include) : null);
    },

    findMany: (args: {
      where?: Record<string, unknown>;
      orderBy?: unknown;
      include?: unknown;
    }): Promise<unknown[]> => {
      let rows = this.friendships.filter((f) => !args.where || whereMatch(f, args.where));
      rows = applyOrderBy(rows, args.orderBy);
      return Promise.resolve(rows.map((f) => this.loadFriendship(f, args.include)));
    },

    update: (args: {
      where: { id: string };
      data: Partial<FriendshipRow>;
      include?: unknown;
    }): Promise<unknown> => {
      const row = this.friendships.find((f) => f.id === args.where.id);
      if (!row) throw new Error(`friendship ${args.where.id} not found`);
      Object.assign(row, args.data);
      return Promise.resolve(this.loadFriendship(row, args.include));
    },

    delete: (args: { where: { id: string } }): Promise<unknown> => {
      const idx = this.friendships.findIndex((f) => f.id === args.where.id);
      if (idx === -1) throw new Error(`friendship ${args.where.id} not found`);
      const [row] = this.friendships.splice(idx, 1);
      return Promise.resolve(this.loadFriendship(row!, undefined));
    },

    deleteMany: (args: { where: Record<string, unknown> }): Promise<{ count: number }> => {
      const before = this.friendships.length;
      for (let i = this.friendships.length - 1; i >= 0; i--) {
        if (whereMatch(this.friendships[i]!, args.where)) this.friendships.splice(i, 1);
      }
      return Promise.resolve({ count: before - this.friendships.length });
    },
  };

  readonly matchInvite = {
    create: (args: {
      data: {
        fromUserId: string;
        toUserId: string;
        bestOf: number;
        selfScoringDisabled?: boolean;
        firstBreakerSlot?: number;
        expiresAt: Date;
      };
      include?: unknown;
    }): Promise<unknown> => {
      const { data } = args;
      const row: MatchInviteRow = {
        id: randomUUID(),
        fromUserId: data.fromUserId,
        toUserId: data.toUserId,
        bestOf: data.bestOf,
        selfScoringDisabled: data.selfScoringDisabled ?? false,
        firstBreakerSlot: data.firstBreakerSlot ?? 0,
        status: 'pending',
        matchId: null,
        createdAt: new Date(CREATED_AT_BASE + this.seq++),
        expiresAt: data.expiresAt,
        respondedAt: null,
      };
      this.matchInvites.push(row);
      return Promise.resolve(this.loadInvite(row, args.include));
    },

    findUnique: (args: { where: { id: string }; include?: unknown }): Promise<unknown> => {
      const row = this.matchInvites.find((i) => i.id === args.where.id);
      return Promise.resolve(row ? this.loadInvite(row, args.include) : null);
    },

    findMany: (args: {
      where?: Record<string, unknown>;
      orderBy?: unknown;
      include?: unknown;
    }): Promise<unknown[]> => {
      let rows = this.matchInvites.filter((i) => !args.where || whereMatch(i, args.where));
      rows = applyOrderBy(rows, args.orderBy);
      return Promise.resolve(rows.map((i) => this.loadInvite(i, args.include)));
    },

    update: (args: {
      where: { id: string };
      data: Partial<MatchInviteRow>;
      include?: unknown;
    }): Promise<unknown> => {
      const row = this.matchInvites.find((i) => i.id === args.where.id);
      if (!row) throw new Error(`match invite ${args.where.id} not found`);
      Object.assign(row, args.data);
      return Promise.resolve(this.loadInvite(row, args.include));
    },
  };

  /** Attach requester/addressee user rows when `include` asks for them. */
  private loadFriendship(f: FriendshipRow, include: unknown): unknown {
    const inc = (include ?? {}) as { requester?: boolean; addressee?: boolean };
    return {
      ...f,
      ...(inc.requester ? { requester: this.findUserRow(f.requesterId) } : {}),
      ...(inc.addressee ? { addressee: this.findUserRow(f.addresseeId) } : {}),
    };
  }

  /** Attach from/to user rows when `include` asks for them. */
  private loadInvite(i: MatchInviteRow, include: unknown): unknown {
    const inc = (include ?? {}) as { from?: boolean; to?: boolean };
    return {
      ...i,
      ...(inc.from ? { from: this.findUserRow(i.fromUserId) } : {}),
      ...(inc.to ? { to: this.findUserRow(i.toUserId) } : {}),
    };
  }

  private findUserRow(id: string): UserRow | null {
    return this.users.find((u) => u.id === id) ?? null;
  }

  /** Assemble a match with its participants (+users) and its event log (by seq). */
  private load(m: MatchRow): LoadedMatch {
    const participants: LoadedParticipant[] = this.participants
      .filter((p) => p.matchId === m.id)
      .map((p) => ({
        ...p,
        user: p.userId ? (this.users.find((u) => u.id === p.userId) ?? null) : null,
      }));
    const events = this.events
      .filter((e) => e.matchId === m.id)
      .sort((a, b) => a.seq - b.seq)
      .map((e) => ({ ...e }));
    return { ...m, participants, events };
  }
}
