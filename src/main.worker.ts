import { LoggerService } from '@nestjs/common';
import { NestFactory } from '@nestjs/core';
import * as Sentry from '@sentry/node';
import { WINSTON_MODULE_NEST_PROVIDER } from 'nest-winston';
import { WorkerModule } from './app/worker.module';
import { initSentry } from './notifications/sentry.bootstrap';

async function bootstrap() {
  initSentry({
    dsn: process.env.SENTRY_DSN,
    environment: process.env.SENTRY_ENVIRONMENT ?? 'development',
    process: 'worker',
  });

  const app = await NestFactory.createApplicationContext(WorkerModule, {
    bufferLogs: true,
  });
  const logger = app.get<LoggerService>(WINSTON_MODULE_NEST_PROVIDER);
  app.useLogger(logger);
  logger.log('Worker started', 'Bootstrap');

  process.on('SIGTERM', () => {
    void app.close();
  });
}
bootstrap().catch((err) => {
  Sentry.captureException(err, { tags: { phase: 'bootstrap' } });

  console.error('Worker bootstrap failed', err);
  process.exit(1);
});
