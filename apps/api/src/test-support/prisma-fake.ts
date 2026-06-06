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

const CREATED_AT_BASE = Date.UTC(2026, 0, 1);

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
