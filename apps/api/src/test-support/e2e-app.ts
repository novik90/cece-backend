import 'reflect-metadata';
import { Global, Module, type INestApplication } from '@nestjs/common';
import { ConfigModule } from '@nestjs/config';
import { NestFactory } from '@nestjs/core';
import { AuthModule } from '../auth/auth.module';
import { UsersModule } from '../users/users.module';
import { MatchesModule } from '../matches/matches.module';
import { ScoringModule } from '../scoring/scoring.module';
import { FriendsModule } from '../friends/friends.module';
import { InvitesModule } from '../invites/invites.module';
import { HealthController } from '../health/health.controller';
import { PrismaService } from '../prisma/prisma.service';
import { AllExceptionsFilter } from '../common/all-exceptions.filter';
import { FakePrisma } from './prisma-fake';

export interface E2eApp {
  app: INestApplication;
  /** The in-memory store — handy for seeding state the API can't yet set. */
  prisma: FakePrisma;
}

/**
 * Boots the real Nest application for e2e/contract tests, but backed by an
 * in-memory {@link FakePrisma} instead of Postgres. Mirrors `main.ts` setup
 * (`/v1` prefix + uniform error filter) so responses match production exactly.
 */
export async function createE2eApp(): Promise<E2eApp> {
  process.env.JWT_SECRET ??= 'test-secret';
  const prisma = new FakePrisma();

  @Global()
  @Module({
    providers: [{ provide: PrismaService, useValue: prisma }],
    exports: [PrismaService],
  })
  class FakePrismaModule {}

  @Module({
    imports: [
      ConfigModule.forRoot({ isGlobal: true }),
      FakePrismaModule,
      AuthModule,
      UsersModule,
      MatchesModule,
      ScoringModule,
      FriendsModule,
      InvitesModule,
    ],
    controllers: [HealthController],
  })
  class TestAppModule {}

  const app = await NestFactory.create(TestAppModule, { logger: false });
  app.setGlobalPrefix('v1');
  app.useGlobalFilters(new AllExceptionsFilter());
  await app.init();
  return { app, prisma };
}
