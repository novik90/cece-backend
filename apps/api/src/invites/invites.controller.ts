import { Body, Controller, Get, HttpCode, Param, Post, Query, UseGuards } from '@nestjs/common';
import type { User as PrismaUser } from '@prisma/client';
import {
  createMatchInviteSchema,
  matchInviteListQuerySchema,
  type CreateMatchInvite,
  type CreateMatchInviteResponse,
  type MatchInviteListQuery,
  type MatchInviteListResponse,
  type MatchResponse,
  type OkResponse,
} from '@cece/contract';
import { JwtAuthGuard } from '../auth/jwt-auth.guard';
import { CurrentUser } from '../auth/current-user.decorator';
import { ZodValidationPipe } from '../common/zod-validation.pipe';
import { InvitesService } from './invites.service';

@UseGuards(JwtAuthGuard)
@Controller('invites')
export class InvitesController {
  constructor(private readonly invites: InvitesService) {}

  /** I1 — POST /v1/invites */
  @Post()
  @HttpCode(201)
  create(
    @CurrentUser() user: PrismaUser,
    @Body(new ZodValidationPipe(createMatchInviteSchema)) dto: CreateMatchInvite,
  ): Promise<CreateMatchInviteResponse> {
    return this.invites.create(user.id, dto);
  }

  /** I2 — GET /v1/invites?direction=&status= */
  @Get()
  list(
    @CurrentUser() user: PrismaUser,
    @Query(new ZodValidationPipe(matchInviteListQuerySchema)) query: MatchInviteListQuery,
  ): Promise<MatchInviteListResponse> {
    return this.invites.list(user.id, query.direction, query.status);
  }

  /** I3 — POST /v1/invites/:id/accept (creates the match) */
  @Post(':id/accept')
  @HttpCode(201)
  accept(@CurrentUser() user: PrismaUser, @Param('id') id: string): Promise<MatchResponse> {
    return this.invites.accept(user.id, id);
  }

  /** I4 — POST /v1/invites/:id/decline */
  @Post(':id/decline')
  @HttpCode(200)
  decline(@CurrentUser() user: PrismaUser, @Param('id') id: string): Promise<OkResponse> {
    return this.invites.decline(user.id, id);
  }

  /** I5 — POST /v1/invites/:id/cancel */
  @Post(':id/cancel')
  @HttpCode(200)
  cancel(@CurrentUser() user: PrismaUser, @Param('id') id: string): Promise<OkResponse> {
    return this.invites.cancel(user.id, id);
  }
}
