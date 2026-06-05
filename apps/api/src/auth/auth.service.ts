import { Injectable } from '@nestjs/common';
import { JwtService } from '@nestjs/jwt';
import { Prisma } from '@prisma/client';
import * as argon2 from 'argon2';
import type { AuthResponse, LoginRequest, RegisterRequest } from '@cece/contract';
import { PrismaService } from '../prisma/prisma.service';
import { ApiError } from '../common/api-error';
import { toUser } from '../common/user.mapper';
import type { JwtPayload } from './jwt-payload';

@Injectable()
export class AuthService {
  constructor(
    private readonly prisma: PrismaService,
    private readonly jwt: JwtService,
  ) {}

  async register(dto: RegisterRequest): Promise<AuthResponse> {
    const passwordHash = await argon2.hash(dto.password, { type: argon2.argon2id });
    try {
      const user = await this.prisma.user.create({
        data: {
          email: dto.email,
          handle: dto.handle,
          displayName: dto.displayName,
          passwordHash,
        },
      });
      return { token: this.sign(user.id), user: toUser(user) };
    } catch (err) {
      if (err instanceof Prisma.PrismaClientKnownRequestError && err.code === 'P2002') {
        const target = (err.meta?.target as string[] | undefined) ?? [];
        if (target.includes('email'))
          throw new ApiError(409, 'email_taken', 'Email already registered');
        if (target.includes('handle'))
          throw new ApiError(409, 'handle_taken', 'Handle already taken');
      }
      throw err;
    }
  }

  async login(dto: LoginRequest): Promise<AuthResponse> {
    const user = await this.prisma.user.findUnique({ where: { email: dto.email } });
    const invalid = (): never => {
      throw new ApiError(401, 'invalid_credentials', 'Invalid email or password');
    };
    if (!user) return invalid();
    const ok = await argon2.verify(user.passwordHash, dto.password);
    if (!ok) return invalid();
    return { token: this.sign(user.id), user: toUser(user) };
  }

  private sign(userId: string): string {
    const payload: JwtPayload = { sub: userId };
    return this.jwt.sign(payload);
  }
}
