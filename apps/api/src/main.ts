import 'reflect-metadata';
import { NestFactory } from '@nestjs/core';
import { AppModule } from './app.module';
import { AllExceptionsFilter } from './common/all-exceptions.filter';

async function bootstrap(): Promise<void> {
  const app = await NestFactory.create(AppModule);
  // All routes are versioned under /v1 (see contract conventions).
  app.setGlobalPrefix('v1');
  // Uniform error envelope { error: { code, message } } for every failure.
  app.useGlobalFilters(new AllExceptionsFilter());
  const port = Number(process.env.PORT ?? 3000);
  await app.listen(port);
  console.log(`cece-api listening on http://localhost:${port}/v1`);
}

void bootstrap();
