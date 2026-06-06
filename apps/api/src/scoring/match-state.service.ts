import { Injectable } from '@nestjs/common';
import type { MatchLiveState, Slot } from '@cece/contract';
import { initialMatchState, reduceMatch, type FrameAction } from '@cece/engine';
import { PrismaService } from '../prisma/prisma.service';
import { ApiError } from '../common/api-error';
import { toParticipantsTuple } from '../common/match.mapper';

/** Event types the frame reducer understands; concede/undo are folded in #26. */
const FRAME_ACTION_TYPES = new Set<FrameAction['type']>(['pot', 'foul', 'endVisit']);

@Injectable()
export class MatchStateService {
  constructor(private readonly prisma: PrismaService) {}

  /**
   * Build the live state for a participant by folding the append-only event log
   * onto the initial state. Throws `match_not_found` / `not_participant`.
   */
  async snapshot(matchId: string, userId: string): Promise<MatchLiveState> {
    const match = await this.prisma.match.findUnique({
      where: { id: matchId },
      include: {
        participants: { include: { user: true } },
        events: { orderBy: { seq: 'asc' } },
      },
    });
    if (!match) throw new ApiError(404, 'match_not_found', 'Match not found');
    if (!match.participants.some((p) => p.userId === userId)) {
      throw new ApiError(403, 'not_participant', 'You are not a participant of this match');
    }

    const initial = initialMatchState({
      matchId: match.id,
      bestOf: match.bestOf,
      participants: toParticipantsTuple(match),
      selfScoringDisabled: match.selfScoringDisabled,
      firstBreaker: (match.firstBreakerSlot === 1 ? 1 : 0) satisfies Slot,
    });

    return match.events.reduce<MatchLiveState>((state, ev) => {
      if (!FRAME_ACTION_TYPES.has(ev.type as FrameAction['type'])) return state;
      const action = { type: ev.type, ...(ev.payload as object) } as FrameAction;
      return reduceMatch(state, action);
    }, initial);
  }
}
