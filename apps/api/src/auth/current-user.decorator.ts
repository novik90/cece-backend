import { createParamDecorator, ExecutionContext } from '@nestjs/common';
import type { User as PrismaUser } from '@prisma/client';
import type { Request } from 'express';

/** Injects the authenticated user (set by JwtAuthGuard). Use on guarded routes. */
export const CurrentUser = createParamDecorator(
  (_data: unknown, ctx: ExecutionContext): PrismaUser => {
    const req = ctx.switchToHttp().getRequest<Request>();
    if (!req.user) {
      throw new Error('CurrentUser used on a route without JwtAuthGuard');
    }
    return req.user;
  },
);
