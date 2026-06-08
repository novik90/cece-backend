import { Controller, Get, Param, UseGuards } from '@nestjs/common';
import type { User as PrismaUser } from '@prisma/client';
import type { UserStats } from '@cece/contract';
import { JwtAuthGuard } from '../auth/jwt-auth.guard';
import { CurrentUser } from '../auth/current-user.decorator';
import { StatsService } from './stats.service';

@UseGuards(JwtAuthGuard)
@Controller()
export class StatsController {
  constructor(private readonly stats: StatsService) {}

  /** GET /v1/me/stats — the caller's own stats. */
  @Get('me/stats')
  mine(@CurrentUser() user: PrismaUser): Promise<UserStats> {
    return this.stats.forUser(user.id, user.id);
  }

  /** GET /v1/users/:id/stats — a user's stats (self, or a friend's). */
  @Get('users/:id/stats')
  forUser(@CurrentUser() user: PrismaUser, @Param('id') id: string): Promise<UserStats> {
    return this.stats.forUser(id, user.id);
  }
}
