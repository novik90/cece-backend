import { Module } from '@nestjs/common';
import { AuthModule } from '../auth/auth.module';
import { ScoringGateway } from './scoring.gateway';
import { MatchStateService } from './match-state.service';

@Module({
  imports: [AuthModule], // provides JwtService (PrismaService is global)
  providers: [ScoringGateway, MatchStateService],
})
export class ScoringModule {}
