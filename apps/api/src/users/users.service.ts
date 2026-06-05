import { Injectable } from '@nestjs/common';
import type { UserSearchResponse } from '@cece/contract';
import { PrismaService } from '../prisma/prisma.service';
import { toPublicUser } from '../common/user.mapper';

const SEARCH_LIMIT = 20;

@Injectable()
export class UsersService {
  constructor(private readonly prisma: PrismaService) {}

  /** Prefix search by handle (case-insensitive), excluding the current user. */
  async search(handlePrefix: string, currentUserId: string): Promise<UserSearchResponse> {
    const users = await this.prisma.user.findMany({
      where: {
        handle: { startsWith: handlePrefix, mode: 'insensitive' },
        id: { not: currentUserId },
      },
      orderBy: { handle: 'asc' },
      take: SEARCH_LIMIT,
    });
    return { users: users.map(toPublicUser) };
  }
}
