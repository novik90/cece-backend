import { Body, Controller, Get, HttpCode, Param, Post, Query, UseGuards } from '@nestjs/common';
import type { User as PrismaUser } from '@prisma/client';
import {
  createMatchRequestSchema,
  matchListQuerySchema,
  type CreateMatchRequest,
  type MatchListQuery,
  type MatchListResponse,
  type MatchResponse,
} from '@cece/contract';
import { JwtAuthGuard } from '../auth/jwt-auth.guard';
import { CurrentUser } from '../auth/current-user.decorator';
import { ZodValidationPipe } from '../common/zod-validation.pipe';
import { MatchesService } from './matches.service';

@UseGuards(JwtAuthGuard)
@Controller('matches')
export class MatchesController {
  constructor(private readonly matches: MatchesService) {}

  /** C5 — POST /v1/matches */
  @Post()
  @HttpCode(201)
  create(
    @CurrentUser() user: PrismaUser,
    @Body(new ZodValidationPipe(createMatchRequestSchema)) dto: CreateMatchRequest,
  ): Promise<MatchResponse> {
    return this.matches.create(user.id, dto);
  }

  /** C6 — GET /v1/matches?status=all|live|completed */
  @Get()
  list(
    @CurrentUser() user: PrismaUser,
    @Query(new ZodValidationPipe(matchListQuerySchema)) query: MatchListQuery,
  ): Promise<MatchListResponse> {
    return this.matches.list(user.id, query.status);
  }

  /** C7 — GET /v1/matches/:id */
  @Get(':id')
  get(@CurrentUser() user: PrismaUser, @Param('id') id: string): Promise<MatchResponse> {
    return this.matches.get(user.id, id);
  }
}
