import {
  Body,
  Controller,
  Delete,
  Get,
  HttpCode,
  Param,
  Post,
  Query,
  Res,
  UseGuards,
} from '@nestjs/common';
import type { Response } from 'express';
import type { User as PrismaUser } from '@prisma/client';
import {
  createFriendRequestSchema,
  friendRequestListQuerySchema,
  type AcceptFriendRequestResponse,
  type CreateFriendRequest,
  type CreateFriendRequestResponse,
  type FriendListResponse,
  type FriendRequestListQuery,
  type FriendRequestListResponse,
  type OkResponse,
} from '@cece/contract';
import { JwtAuthGuard } from '../auth/jwt-auth.guard';
import { CurrentUser } from '../auth/current-user.decorator';
import { ZodValidationPipe } from '../common/zod-validation.pipe';
import { FriendsService } from './friends.service';

@UseGuards(JwtAuthGuard)
@Controller('friends')
export class FriendsController {
  constructor(private readonly friends: FriendsService) {}

  /** F1 — POST /v1/friends/requests. 201 when created, 200 when it auto-befriends. */
  @Post('requests')
  async sendRequest(
    @CurrentUser() user: PrismaUser,
    @Body(new ZodValidationPipe(createFriendRequestSchema)) dto: CreateFriendRequest,
    @Res({ passthrough: true }) res: Response,
  ): Promise<CreateFriendRequestResponse> {
    const result = await this.friends.sendRequest(user.id, dto.userId);
    res.status('befriended' in result ? 200 : 201);
    return result;
  }

  /** F2 — GET /v1/friends/requests?direction=incoming|outgoing */
  @Get('requests')
  listRequests(
    @CurrentUser() user: PrismaUser,
    @Query(new ZodValidationPipe(friendRequestListQuerySchema)) query: FriendRequestListQuery,
  ): Promise<FriendRequestListResponse> {
    return this.friends.listRequests(user.id, query.direction);
  }

  /** F3 — POST /v1/friends/requests/:id/accept */
  @Post('requests/:id/accept')
  @HttpCode(200)
  accept(
    @CurrentUser() user: PrismaUser,
    @Param('id') id: string,
  ): Promise<AcceptFriendRequestResponse> {
    return this.friends.accept(user.id, id);
  }

  /** F4 — POST /v1/friends/requests/:id/decline */
  @Post('requests/:id/decline')
  @HttpCode(200)
  decline(@CurrentUser() user: PrismaUser, @Param('id') id: string): Promise<OkResponse> {
    return this.friends.decline(user.id, id);
  }

  /** F5 — GET /v1/friends */
  @Get()
  listFriends(@CurrentUser() user: PrismaUser): Promise<FriendListResponse> {
    return this.friends.listFriends(user.id);
  }

  /** F6 — DELETE /v1/friends/:userId */
  @Delete(':userId')
  @HttpCode(204)
  remove(@CurrentUser() user: PrismaUser, @Param('userId') userId: string): Promise<void> {
    return this.friends.removeFriend(user.id, userId);
  }
}
