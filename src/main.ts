import { BadRequestException, ValidationPipe } from '@nestjs/common';
import { NestFactory } from '@nestjs/core';
import { DocumentBuilder, SwaggerModule } from '@nestjs/swagger';
import * as Sentry from '@sentry/node';
import { WINSTON_MODULE_NEST_PROVIDER } from 'nest-winston';
import { ApiModule } from './app/api.module';
import { AllExceptionsFilter } from './notifications/all-exceptions.filter';
import { initSentry } from './notifications/sentry.bootstrap';

async function bootstrap() {
  initSentry({
    dsn: process.env.SENTRY_DSN,
    environment: process.env.SENTRY_ENVIRONMENT ?? 'development',
    process: 'api',
  });

  const app = await NestFactory.create(ApiModule, { bufferLogs: true });
  app.useLogger(app.get(WINSTON_MODULE_NEST_PROVIDER));

  app.useGlobalPipes(
    new ValidationPipe({
      whitelist: true,
      forbidNonWhitelisted: true,
      transform: true,
      transformOptions: { enableImplicitConversion: true },
      exceptionFactory: (errors) =>
        new BadRequestException({
          message: 'Validation failed',
          errors: errors.map((e) => ({
            field: e.property,
            constraints: e.constraints,
          })),
        }),
    }),
  );
  app.useGlobalFilters(new AllExceptionsFilter());

  const swaggerConfig = new DocumentBuilder()
    .setTitle('Queues API')
    .setDescription('Delivery + retry + DLQ admin')
    .setVersion('1.0')
    .build();
  SwaggerModule.setup(
    'api/docs',
    app,
    SwaggerModule.createDocument(app, swaggerConfig),
  );

  await app.listen(process.env.PORT ?? 3000);
}
bootstrap().catch((err) => {
  Sentry.captureException(err, { tags: { phase: 'bootstrap' } });

  console.error('API bootstrap failed', err);
  process.exit(1);
});
