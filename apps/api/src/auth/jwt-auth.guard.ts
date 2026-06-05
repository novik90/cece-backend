import { CanActivate, ExecutionContext, Injectable } from '@nestjs/common';
import { JwtService } from '@nestjs/jwt';
import type { Request } from 'express';
import { PrismaService } from '../prisma/prisma.service';
import { ApiError } from '../common/api-error';
import type { JwtPayload } from './jwt-payload';

/**
 * Protects routes: requires a valid `Authorization: Bearer <jwt>` and loads
 * the user onto the request (read via the `@CurrentUser()` decorator).
 */
@Injectable()
export class JwtAuthGuard implements CanActivate {
  constructor(
    private readonly jwt: JwtService,
    private readonly prisma: PrismaService,
  ) {}

  async canActivate(context: ExecutionContext): Promise<boolean> {
    const req = context.switchToHttp().getRequest<Request>();
    const header = req.headers.authorization;
    if (!header?.startsWith('Bearer ')) {
      throw new ApiError(401, 'unauthorized', 'Missing bearer token');
    }

    let payload: JwtPayload;
    try {
      payload = await this.jwt.verifyAsync<JwtPayload>(header.slice('Bearer '.length));
    } catch {
      throw new ApiError(401, 'unauthorized', 'Invalid or expired token');
    }

    const user = await this.prisma.user.findUnique({ where: { id: payload.sub } });
    if (!user) {
      throw new ApiError(401, 'unauthorized', 'User no longer exists');
    }

    req.user = user;
    return true;
  }
}
