import { Controller, Get, Query, UseGuards } from '@nestjs/common';
import type { User as PrismaUser } from '@prisma/client';
import {
  userSearchQuerySchema,
  type MeResponse,
  type UserSearchQuery,
  type UserSearchResponse,
} from '@cece/contract';
import { JwtAuthGuard } from '../auth/jwt-auth.guard';
import { CurrentUser } from '../auth/current-user.decorator';
import { ZodValidationPipe } from '../common/zod-validation.pipe';
import { toUser } from '../common/user.mapper';
import { UsersService } from './users.service';

@UseGuards(JwtAuthGuard)
@Controller()
export class UsersController {
  constructor(private readonly users: UsersService) {}

  /** C3 — GET /v1/me */
  @Get('me')
  me(@CurrentUser() user: PrismaUser): MeResponse {
    return toUser(user);
  }

  /** C4 — GET /v1/users?handle=iva */
  @Get('users')
  search(
    @CurrentUser() user: PrismaUser,
    @Query(new ZodValidationPipe(userSearchQuerySchema)) query: UserSearchQuery,
  ): Promise<UserSearchResponse> {
    return this.users.search(query.handle, user.id);
  }
}
