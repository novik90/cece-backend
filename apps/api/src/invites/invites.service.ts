import { Injectable } from '@nestjs/common';
import type { User as PrismaUser } from '@prisma/client';
import type {
  CreateMatchInvite,
  CreateMatchInviteResponse,
  MatchInvite,
  MatchInviteDirection,
  MatchInviteListResponse,
  MatchInviteStatus,
  MatchResponse,
  OkResponse,
} from '@cece/contract';
import { PrismaService } from '../prisma/prisma.service';
import { ApiError } from '../common/api-error';
import { toPublicUser } from '../common/user.mapper';
import { MATCH_INCLUDE, toMatch } from '../common/match.mapper';

/** A match invite with both users loaded (the include used throughout). */
type LoadedInvite = {
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
  from: PrismaUser;
  to: PrismaUser;
};

const WITH_USERS = { from: true, to: true } as const;

/** A pending invite lives 24h after creation. */
const INVITE_TTL_MS = 24 * 60 * 60 * 1000;

@Injectable()
export class InvitesService {
  constructor(private readonly prisma: PrismaService) {}

  /** I1 — create a pending invite (expires in 24h). Anyone may be invited. */
  async create(meId: string, dto: CreateMatchInvite): Promise<CreateMatchInviteResponse> {
    if (dto.userId === meId) {
      throw new ApiError(422, 'validation_error', 'You cannot invite yourself');
    }
    const target = await this.prisma.user.findUnique({ where: { id: dto.userId } });
    if (!target) throw new ApiError(404, 'user_not_found', 'User not found');

    const invite = (await this.prisma.matchInvite.create({
      data: {
        fromUserId: meId,
        toUserId: dto.userId,
        bestOf: dto.bestOf,
        selfScoringDisabled: dto.selfScoringDisabled,
        firstBreakerSlot: dto.firstBreaker,
        expiresAt: new Date(Date.now() + INVITE_TTL_MS),
      },
      include: WITH_USERS,
    })) as LoadedInvite;
    return this.toMatchInvite(invite);
  }

  /** I2 — list invites by direction, optionally filtered by (effective) status. */
  async list(
    meId: string,
    direction: MatchInviteDirection,
    status?: MatchInviteStatus,
  ): Promise<MatchInviteListResponse> {
    const where = direction === 'incoming' ? { toUserId: meId } : { fromUserId: meId };
    const rows = (await this.prisma.matchInvite.findMany({
      where,
      orderBy: { createdAt: 'desc' },
      include: WITH_USERS,
    })) as LoadedInvite[];
    let invites = rows.map((r) => this.toMatchInvite(r));
    if (status) invites = invites.filter((i) => i.status === status);
    return { invites };
  }

  /** I3 — accept (invitee only): creates the match and links it to the invite. */
  async accept(meId: string, id: string): Promise<MatchResponse> {
    const invite = await this.loadForAction(id, meId, 'invitee');
    return this.prisma.$transaction(async (tx) => {
      const match = await tx.match.create({
        data: {
          ownerId: invite.fromUserId,
          bestOf: invite.bestOf,
          selfScoringDisabled: invite.selfScoringDisabled,
          firstBreakerSlot: invite.firstBreakerSlot,
          participants: {
            create: [
              { slot: 0, userId: invite.fromUserId },
              { slot: 1, userId: invite.toUserId },
            ],
          },
        },
        include: MATCH_INCLUDE,
      });
      await tx.matchInvite.update({
        where: { id: invite.id },
        data: { status: 'accepted', matchId: match.id, respondedAt: new Date() },
      });
      return toMatch(match);
    });
  }

  /** I4 — decline (invitee only). */
  async decline(meId: string, id: string): Promise<OkResponse> {
    const invite = await this.loadForAction(id, meId, 'invitee');
    await this.prisma.matchInvite.update({
      where: { id: invite.id },
      data: { status: 'declined', respondedAt: new Date() },
    });
    return { ok: true };
  }

  /** I5 — cancel (sender only). */
  async cancel(meId: string, id: string): Promise<OkResponse> {
    const invite = await this.loadForAction(id, meId, 'sender');
    await this.prisma.matchInvite.update({
      where: { id: invite.id },
      data: { status: 'cancelled', respondedAt: new Date() },
    });
    return { ok: true };
  }

  /** Load a pending, non-expired invite and assert the caller's role. */
  private async loadForAction(
    id: string,
    meId: string,
    role: 'invitee' | 'sender',
  ): Promise<LoadedInvite> {
    const invite = (await this.prisma.matchInvite.findUnique({
      where: { id },
      include: WITH_USERS,
    })) as LoadedInvite | null;
    if (!invite) throw new ApiError(404, 'invite_not_found', 'Invite not found');
    const holderId = role === 'invitee' ? invite.toUserId : invite.fromUserId;
    if (holderId !== meId) throw new ApiError(403, 'forbidden', 'Not allowed');
    if (invite.status !== 'pending') {
      throw new ApiError(409, 'invite_not_pending', 'This invite is no longer pending');
    }
    if (this.isExpired(invite)) {
      throw new ApiError(409, 'invite_expired', 'This invite has expired');
    }
    return invite;
  }

  private isExpired(invite: LoadedInvite): boolean {
    return invite.status === 'pending' && Date.now() > invite.expiresAt.getTime();
  }

  private toMatchInvite(invite: LoadedInvite): MatchInvite {
    const firstBreaker = invite.firstBreakerSlot === 1 ? 1 : 0;
    const result: MatchInvite = {
      id: invite.id,
      from: toPublicUser(invite.from),
      to: toPublicUser(invite.to),
      bestOf: invite.bestOf,
      selfScoringDisabled: invite.selfScoringDisabled,
      firstBreaker,
      status: this.isExpired(invite) ? 'expired' : invite.status,
      createdAt: invite.createdAt.toISOString(),
      expiresAt: invite.expiresAt.toISOString(),
    };
    if (invite.matchId) result.matchId = invite.matchId;
    return result;
  }
}
