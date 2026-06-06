import { Injectable } from '@nestjs/common';
import type {
  CreateMatchRequest,
  MatchListResponse,
  MatchListStatus,
  MatchResponse,
} from '@cece/contract';
import { PrismaService } from '../prisma/prisma.service';
import { ApiError } from '../common/api-error';
import { MATCH_INCLUDE, toMatch, toMatchSummary } from '../common/match.mapper';

@Injectable()
export class MatchesService {
  constructor(private readonly prisma: PrismaService) {}

  /** C5 — create a match; the creator becomes participants[0] (slot 0). */
  async create(ownerId: string, dto: CreateMatchRequest): Promise<MatchResponse> {
    const { opponent } = dto;
    if ('userId' in opponent) {
      if (opponent.userId === ownerId) {
        throw new ApiError(422, 'validation_error', 'opponent.userId must differ from the creator');
      }
      const exists = await this.prisma.user.findUnique({ where: { id: opponent.userId } });
      if (!exists) throw new ApiError(404, 'user_not_found', 'Opponent user not found');
    }

    const match = await this.prisma.match.create({
      data: {
        ownerId,
        bestOf: dto.bestOf,
        selfScoringDisabled: dto.selfScoringDisabled,
        firstBreakerSlot: dto.firstBreaker,
        participants: {
          create: [
            { slot: 0, userId: ownerId },
            'userId' in opponent
              ? { slot: 1, userId: opponent.userId }
              : { slot: 1, guestName: opponent.guestName },
          ],
        },
      },
      include: MATCH_INCLUDE,
    });
    return toMatch(match);
  }

  /** C6 — list only the caller's matches, newest first. */
  async list(userId: string, status: MatchListStatus): Promise<MatchListResponse> {
    const matches = await this.prisma.match.findMany({
      where: {
        participants: { some: { userId } },
        ...(status === 'all' ? {} : { status }),
      },
      orderBy: { createdAt: 'desc' },
      include: MATCH_INCLUDE,
    });
    return { matches: matches.map(toMatchSummary) };
  }

  /** C7 — one match; only a participant may read it. */
  async get(userId: string, id: string): Promise<MatchResponse> {
    const match = await this.prisma.match.findUnique({
      where: { id },
      include: MATCH_INCLUDE,
    });
    if (!match) throw new ApiError(404, 'match_not_found', 'Match not found');
    const isParticipant = match.participants.some((p) => p.userId === userId);
    if (!isParticipant) {
      throw new ApiError(403, 'not_participant', 'You are not a participant of this match');
    }
    return toMatch(match);
  }
}
