import type {
  Match as PrismaMatch,
  MatchParticipant as PrismaParticipant,
  User as PrismaUser,
} from '@prisma/client';
import type { FramesWon, Match, MatchSummary, Participant } from '@cece/contract';

/** A match loaded with its two participants and their (optional) users. */
export type MatchWithParticipants = PrismaMatch & {
  participants: (PrismaParticipant & { user: PrismaUser | null })[];
};

/** Prisma `include` to load everything the mappers below need. */
export const MATCH_INCLUDE = {
  participants: { include: { user: true } },
} as const;

function toParticipant(p: PrismaParticipant & { user: PrismaUser | null }): Participant {
  if (p.user) {
    return {
      kind: 'user',
      userId: p.user.id,
      handle: p.user.handle,
      displayName: p.user.displayName,
    };
  }
  return { kind: 'guest', name: p.guestName ?? 'Unknown player' };
}

/** The two participants as a slot-ordered tuple. */
export function toParticipantsTuple(m: MatchWithParticipants): [Participant, Participant] {
  const bySlot = [...m.participants].sort((a, b) => a.slot - b.slot);
  return [toParticipant(bySlot[0]!), toParticipant(bySlot[1]!)];
}

export function toMatchSummary(m: MatchWithParticipants): MatchSummary {
  const participants = toParticipantsTuple(m);
  const framesWon: FramesWon = [m.framesWonA, m.framesWonB];

  const summary: MatchSummary = {
    id: m.id,
    participants,
    bestOf: m.bestOf,
    status: m.status,
    framesWon,
    createdAt: m.createdAt.toISOString(),
  };
  if (m.winnerSlot != null) summary.winner = participants[m.winnerSlot];
  if (m.completedAt) summary.completedAt = m.completedAt.toISOString();
  return summary;
}

export function toMatch(m: MatchWithParticipants): Match {
  const match: Match = { ...toMatchSummary(m), ownerId: m.ownerId };
  if (m.activeScorerUserId) match.activeScorerUserId = m.activeScorerUserId;
  return match;
}
