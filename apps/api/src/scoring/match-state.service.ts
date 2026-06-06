import { Injectable } from '@nestjs/common';
import { Prisma } from '@prisma/client';
import type { MatchLiveState, ScoringAction, Slot } from '@cece/contract';
import { initialMatchState, reduceMatch, EngineError, type FrameAction } from '@cece/engine';
import { PrismaService } from '../prisma/prisma.service';
import { ApiError } from '../common/api-error';
import { toParticipantsTuple, type MatchWithParticipants } from '../common/match.mapper';

type StoredEvent = { type: string; payload: Prisma.JsonValue };
type LoadedMatch = MatchWithParticipants & { events: StoredEvent[] };

const MATCH_LOAD = {
  participants: { include: { user: true } },
  events: { orderBy: { seq: 'asc' } },
} as const;

function engineToApi(e: EngineError): ApiError {
  const status = e.code === 'match_not_live' ? 409 : e.code === 'invalid_action' ? 422 : 403;
  return new ApiError(status, e.code, e.message);
}

@Injectable()
export class MatchStateService {
  constructor(private readonly prisma: PrismaService) {}

  /** Live state for a participant (read-only). Throws 404/403. */
  async snapshot(matchId: string, userId: string): Promise<MatchLiveState> {
    const match = await this.prisma.match.findUnique({ where: { id: matchId }, include: MATCH_LOAD });
    if (!match) throw new ApiError(404, 'match_not_found', 'Match not found');
    requireParticipant(match, userId);
    return buildState(match);
  }

  /**
   * Apply a scoring action: validate via the engine, append to the event log,
   * and update the persisted match row — atomically. Returns the new live state.
   * Handles pot/foul/endVisit and undo; concede lands with #26.
   */
  async apply(matchId: string, userId: string, action: ScoringAction): Promise<MatchLiveState> {
    return this.prisma.$transaction(async (tx) => {
      const match = await tx.match.findUnique({ where: { id: matchId }, include: MATCH_LOAD });
      if (!match) throw new ApiError(404, 'match_not_found', 'Match not found');
      const me = requireParticipant(match, userId);

      const seq = match.events.length;
      const actorSlot: Slot = me.slot === 1 ? 1 : 0;
      const next =
        action.type === 'undo'
          ? this.computeUndo(match)
          : this.computeAction(match, action, actorSlot);

      await tx.matchEvent.create({
        data: { matchId, seq, type: action.type, payload: payloadOf(action), byUserId: userId },
      });
      await tx.match.update({ where: { id: matchId }, data: matchRowPatch(next) });
      return next;
    });
  }

  private computeUndo(match: LoadedMatch): MatchLiveState {
    if (effectiveEvents(match.events).length === 0) {
      throw new ApiError(409, 'nothing_to_undo', 'Nothing to undo');
    }
    // Append the undo event and re-fold (undo-aware fold pops the last action).
    return buildState({ ...match, events: [...match.events, { type: 'undo', payload: {} }] });
  }

  private computeAction(match: LoadedMatch, action: ScoringAction, actor: Slot): MatchLiveState {
    const current = buildState(match);
    if (
      action.type === 'pot' &&
      current.selfScoringDisabled &&
      current.frame?.striker === actor
    ) {
      throw new ApiError(403, 'self_scoring_forbidden', 'You cannot score points for yourself');
    }
    try {
      const next = reduceMatch(current, action as FrameAction);
      return { ...next, version: match.events.length + 1 };
    } catch (err) {
      if (err instanceof EngineError) throw engineToApi(err);
      throw err;
    }
  }
}

function requireParticipant(match: MatchWithParticipants, userId: string) {
  const me = match.participants.find((p) => p.userId === userId);
  if (!me) throw new ApiError(403, 'not_participant', 'You are not a participant of this match');
  return me;
}

/** Drop the action cancelled by each `undo` event (append-only, audit kept). */
function effectiveEvents(events: StoredEvent[]): StoredEvent[] {
  const stack: StoredEvent[] = [];
  for (const ev of events) {
    if (ev.type === 'undo') stack.pop();
    else stack.push(ev);
  }
  return stack;
}

/** Fold the event log onto the initial state; `version` counts all stored events. */
function buildState(match: LoadedMatch): MatchLiveState {
  const initial = initialMatchState({
    matchId: match.id,
    bestOf: match.bestOf,
    participants: toParticipantsTuple(match),
    selfScoringDisabled: match.selfScoringDisabled,
    firstBreaker: (match.firstBreakerSlot === 1 ? 1 : 0) satisfies Slot,
  });
  const state = effectiveEvents(match.events).reduce<MatchLiveState>((s, ev) => {
    const action = { type: ev.type, ...(ev.payload as object) } as FrameAction;
    return reduceMatch(s, action);
  }, initial);
  return { ...state, version: match.events.length };
}

function payloadOf(action: ScoringAction): Prisma.InputJsonValue {
  if (action.type === 'pot') return { ball: action.ball };
  if (action.type === 'foul') return { points: action.points };
  return {};
}

function matchRowPatch(state: MatchLiveState) {
  const completed = state.status === 'completed';
  return {
    status: state.status,
    framesWonA: state.framesWon[0],
    framesWonB: state.framesWon[1],
    winnerSlot: completed ? (state.framesWon[0] > state.framesWon[1] ? 0 : 1) : null,
    completedAt: completed ? new Date() : null,
  };
}
