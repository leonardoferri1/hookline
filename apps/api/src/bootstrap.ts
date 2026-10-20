import 'reflect-metadata';
import { LogLevel, ValidationPipe, VersioningType } from '@nestjs/common';
import { NestFactory } from '@nestjs/core';
import { NestExpressApplication } from '@nestjs/platform-express';
import { DocumentBuilder, SwaggerModule } from '@nestjs/swagger';
import helmet from 'helmet';
import { AppModule } from './app.module';
import { APP_CONFIG, AppConfig, loadAppConfig } from './config/app-config';
import { ProblemDetailsFilter } from './shared/http/problem-details.filter';
import { requestLogging } from './shared/logging/request-logging.middleware';
import { StructuredLogger } from './shared/logging/structured-logger';
import { Database } from './shared/database/database.service';
import { runMigrations } from './shared/database/migration-runner';
import { seedDemoData } from './cli/seed';

export interface BootstrapOptions {
  /** Overrides the environment-derived configuration; used by the test harness. */
  config?: AppConfig;
  logLevels?: LogLevel[];
  /** Applies pending migrations before the application starts accepting traffic. */
  migrate?: boolean;
}

/**
 * Builds the HTTP application without binding a port, so integration tests exercise the same
 * pipeline (versioning, validation, problem documents, security headers) the process uses.
 */
export async function createApiApp(
  options: BootstrapOptions = {},
): Promise<NestExpressApplication> {
  const config = options.config ?? loadAppConfig();
  const logger = new StructuredLogger(options.logLevels ?? ['log', 'warn', 'error']);

  const app = await NestFactory.create<NestExpressApplication>(AppModule, {
    logger,
    bodyParser: false,
  });
  app.get(APP_CONFIG); // Fails fast if configuration is unusable.

  if (options.migrate ?? true) await runMigrations(app.get(Database).pool, logger);

  app.useBodyParser('json', { limit: config.maxPayloadBytes });
  app.setGlobalPrefix('api');
  app.enableVersioning({ type: VersioningType.URI, defaultVersion: '1' });
  app.enableShutdownHooks();
  app.use(helmet({ contentSecurityPolicy: false }));
  app.use(requestLogging(logger));
  app.enableCors({
    origin: [config.consoleOrigin],
    credentials: true,
    allowedHeaders: ['Authorization', 'Content-Type', 'Idempotency-Key', 'X-Request-Id'],
    exposedHeaders: ['X-Request-Id', 'Retry-After'],
  });
  app.useGlobalPipes(
    new ValidationPipe({
      whitelist: true,
      forbidNonWhitelisted: true,
      transform: true,
      transformOptions: { enableImplicitConversion: false },
    }),
  );
  app.useGlobalFilters(new ProblemDetailsFilter(logger));

  const document = SwaggerModule.createDocument(
    app,
    new DocumentBuilder()
      .setTitle('Hookline')
      .setDescription(
        'Webhook delivery platform: publish events, deliver them to signed destinations, retry failures and replay history.',
      )
      .setVersion('1')
      .addBearerAuth({ type: 'http', scheme: 'bearer', description: 'Tenant API key.' }, 'apiKey')
      .build(),
  );
  SwaggerModule.setup('api/docs', app, document);

  if (config.seedDemoData)
    await seedDemoData(app, {
      receiverUrl: config.receiverUrl,
      credentialsFile: config.demoCredentialsFile,
    });

  return app;
}

export { AppConfig };
