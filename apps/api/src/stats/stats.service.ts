import { Injectable } from '@nestjs/common';
import type { BreakStat, UserStats } from '@cece/contract';
import { PrismaService } from '../prisma/prisma.service';
import { ApiError } from '../common/api-error';
import { toParticipantsTuple } from '../common/match.mapper';
import { foldMatchState, MATCH_LOAD, type LoadedMatch } from '../scoring/match-state.service';

/** How many notable breaks to return. */
const TOP_BREAKS = 5;

@Injectable()
export class StatsService {
  constructor(private readonly prisma: PrismaService) {}

  /**
   * Aggregate `targetId`'s stats over their completed matches. Own stats are
   * always visible; another user's only to a friend (else 403 not_friends).
   */
  async forUser(targetId: string, viewerId: string): Promise<UserStats> {
    const target = await this.prisma.user.findUnique({ where: { id: targetId } });
    if (!target) throw new ApiError(404, 'user_not_found', 'User not found');

    if (targetId !== viewerId) {
      const friendship = await this.prisma.friendship.findFirst({
        where: {
          status: 'accepted',
          OR: [
            { requesterId: viewerId, addresseeId: targetId },
            { requesterId: targetId, addresseeId: viewerId },
          ],
        },
      });
      if (!friendship) throw new ApiError(403, 'not_friends', 'You can only view a friend’s stats');
    }

    const matches = (await this.prisma.match.findMany({
      where: { participants: { some: { userId: targetId } }, status: 'completed' },
      orderBy: { completedAt: 'desc' },
      include: MATCH_LOAD,
    })) as LoadedMatch[];

    return aggregate(targetId, matches);
  }
}

function aggregate(userId: string, matches: LoadedMatch[]): UserStats {
  let wins = 0;
  let framesWon = 0;
  let framesLost = 0;
  let highestBreak = 0;
  const breaks: BreakStat[] = [];

  for (const match of matches) {
    const me = match.participants.find((p) => p.userId === userId);
    if (!me) continue;
    const slot = me.slot === 1 ? 1 : 0;
    const opponentSlot = slot === 0 ? 1 : 0;

    framesWon += slot === 0 ? match.framesWonA : match.framesWonB;
    framesLost += slot === 0 ? match.framesWonB : match.framesWonA;
    if (match.winnerSlot === slot) wins += 1;

    const state = foldMatchState(match);
    const hb = state.highestBreak[slot];
    if (hb > highestBreak) highestBreak = hb;
    if (hb > 0) {
      breaks.push({
        value: hb,
        matchId: match.id,
        opponent: toParticipantsTuple(match)[opponentSlot],
        playedAt: (match.completedAt ?? match.createdAt).toISOString(),
      });
    }
  }

  const matchesPlayed = matches.length;
  const losses = matchesPlayed - wins;
  const winRate = matchesPlayed === 0 ? 0 : Math.round((wins / matchesPlayed) * 1000) / 1000;
  breaks.sort((a, b) => b.value - a.value);

  return {
    userId,
    matchesPlayed,
    wins,
    losses,
    winRate,
    framesWon,
    framesLost,
    highestBreak,
    topBreaks: breaks.slice(0, TOP_BREAKS),
  };
}
