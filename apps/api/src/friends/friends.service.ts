import { Injectable } from '@nestjs/common';
import type { User as PrismaUser } from '@prisma/client';
import type {
  AcceptFriendRequestResponse,
  CreateFriendRequestResponse,
  FriendListResponse,
  FriendRequest,
  FriendRequestDirection,
  FriendRequestListResponse,
  OkResponse,
} from '@cece/contract';
import { PrismaService } from '../prisma/prisma.service';
import { ApiError } from '../common/api-error';
import { toPublicUser } from '../common/user.mapper';

/** A friendship row with both sides loaded (the include used throughout). */
type LoadedFriendship = {
  id: string;
  requesterId: string;
  addresseeId: string;
  status: 'pending' | 'accepted';
  createdAt: Date;
  requester: PrismaUser;
  addressee: PrismaUser;
};

const WITH_USERS = { requester: true, addressee: true } as const;

@Injectable()
export class FriendsService {
  constructor(private readonly prisma: PrismaService) {}

  /** F1 — send a friend request; a matching counter-request auto-accepts. */
  async sendRequest(meId: string, targetId: string): Promise<CreateFriendRequestResponse> {
    if (targetId === meId) {
      throw new ApiError(422, 'validation_error', 'You cannot befriend yourself');
    }
    const target = await this.prisma.user.findUnique({ where: { id: targetId } });
    if (!target) throw new ApiError(404, 'user_not_found', 'User not found');

    const existing = (await this.prisma.friendship.findFirst({
      where: {
        OR: [
          { requesterId: meId, addresseeId: targetId },
          { requesterId: targetId, addresseeId: meId },
        ],
      },
      include: WITH_USERS,
    })) as LoadedFriendship | null;

    if (existing) {
      if (existing.status === 'accepted') {
        throw new ApiError(409, 'already_friends', 'You are already friends');
      }
      // status pending
      if (existing.requesterId === meId) {
        throw new ApiError(409, 'friend_request_exists', 'A friend request is already pending');
      }
      // counter-request from the target → become friends immediately.
      await this.prisma.friendship.update({
        where: { id: existing.id },
        data: { status: 'accepted', respondedAt: new Date() },
      });
      return { befriended: true, friend: toPublicUser(target) };
    }

    const created = (await this.prisma.friendship.create({
      data: { requesterId: meId, addresseeId: targetId },
      include: WITH_USERS,
    })) as LoadedFriendship;
    return this.toFriendRequest(created, 'outgoing');
  }

  /** F2 — list my pending requests (incoming by default). */
  async listRequests(
    meId: string,
    direction: FriendRequestDirection,
  ): Promise<FriendRequestListResponse> {
    const where =
      direction === 'incoming'
        ? { addresseeId: meId, status: 'pending' as const }
        : { requesterId: meId, status: 'pending' as const };
    const rows = (await this.prisma.friendship.findMany({
      where,
      orderBy: { createdAt: 'desc' },
      include: WITH_USERS,
    })) as LoadedFriendship[];
    return { requests: rows.map((r) => this.toFriendRequest(r, direction)) };
  }

  /** F3 — accept a pending request (addressee only). */
  async accept(meId: string, id: string): Promise<AcceptFriendRequestResponse> {
    const fr = await this.findPendingForRole(id, meId, 'addressee');
    await this.prisma.friendship.update({
      where: { id: fr.id },
      data: { status: 'accepted', respondedAt: new Date() },
    });
    return { friend: toPublicUser(fr.requester) };
  }

  /** F4 — decline a pending request (addressee only); removes the row. */
  async decline(meId: string, id: string): Promise<OkResponse> {
    const fr = await this.findPendingForRole(id, meId, 'addressee');
    await this.prisma.friendship.delete({ where: { id: fr.id } });
    return { ok: true };
  }

  /** F5 — list accepted friends (the other side of each accepted row). */
  async listFriends(meId: string): Promise<FriendListResponse> {
    const rows = (await this.prisma.friendship.findMany({
      where: {
        status: 'accepted',
        OR: [{ requesterId: meId }, { addresseeId: meId }],
      },
      include: WITH_USERS,
    })) as LoadedFriendship[];
    const friends = rows
      .map((r) => (r.requesterId === meId ? r.addressee : r.requester))
      .map(toPublicUser)
      .sort((a, b) => a.handle.localeCompare(b.handle));
    return { friends };
  }

  /** F6 — remove a friend (accepted row in either direction). */
  async removeFriend(meId: string, userId: string): Promise<void> {
    const { count } = await this.prisma.friendship.deleteMany({
      where: {
        status: 'accepted',
        OR: [
          { requesterId: meId, addresseeId: userId },
          { requesterId: userId, addresseeId: meId },
        ],
      },
    });
    if (count === 0) throw new ApiError(404, 'not_friends', 'This user is not your friend');
  }

  /** Load a pending request and assert the caller holds the required role. */
  private async findPendingForRole(
    id: string,
    meId: string,
    role: 'addressee' | 'requester',
  ): Promise<LoadedFriendship> {
    const fr = (await this.prisma.friendship.findUnique({
      where: { id },
      include: WITH_USERS,
    })) as LoadedFriendship | null;
    if (!fr) throw new ApiError(404, 'friend_request_not_found', 'Friend request not found');
    const holderId = role === 'addressee' ? fr.addresseeId : fr.requesterId;
    if (holderId !== meId) throw new ApiError(403, 'forbidden', 'Not allowed');
    if (fr.status !== 'pending') {
      throw new ApiError(409, 'request_not_pending', 'This request is no longer pending');
    }
    return fr;
  }

  private toFriendRequest(fr: LoadedFriendship, direction: FriendRequestDirection): FriendRequest {
    const other = direction === 'incoming' ? fr.requester : fr.addressee;
    return {
      id: fr.id,
      user: toPublicUser(other),
      direction,
      createdAt: fr.createdAt.toISOString(),
    };
  }
}
