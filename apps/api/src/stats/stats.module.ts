import { Module } from '@nestjs/common';
import { AuthModule } from '../auth/auth.module';
import { StatsController } from './stats.controller';
import { StatsService } from './stats.service';

@Module({
  imports: [AuthModule], // provides JwtAuthGuard
  controllers: [StatsController],
  providers: [StatsService],
})
export class StatsModule {}
