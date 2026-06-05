import { Controller, Get } from '@nestjs/common';
import { CONTRACT_VERSION } from '@cece/contract';

export type HealthResponse = {
  status: 'ok';
  apiVersion: string;
};

@Controller('health')
export class HealthController {
  @Get()
  check(): HealthResponse {
    return { status: 'ok', apiVersion: CONTRACT_VERSION };
  }
}
