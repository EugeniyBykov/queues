import * as Sentry from '@sentry/node';

export interface SentryBootstrapOptions {
  dsn?: string;
  environment: string;
  process: 'api' | 'worker';
}

export function initSentry(options: SentryBootstrapOptions): void {
  if (!options.dsn) return;
  Sentry.init({
    dsn: options.dsn,
    environment: options.environment,
    initialScope: { tags: { process: options.process } },
  });
}
