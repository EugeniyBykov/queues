export default () => ({
  app: {
    nodeEnv: process.env.NODE_ENV ?? 'development',
    port: Number(process.env.PORT ?? 3000),
  },
  database: {
    host: process.env.DB_HOST,
    port: Number(process.env.DB_PORT ?? 5432),
    user: process.env.DB_USER,
    password: process.env.DB_PASSWORD,
    name: process.env.DB_NAME,
  },
  redis: {
    host: process.env.REDIS_HOST,
    port: Number(process.env.REDIS_PORT ?? 6379),
  },
  delivery: {
    internalServiceUrl: process.env.INTERNAL_SERVICE_URL,
    emailServiceUrl: process.env.EMAIL_SERVICE_URL,
    channelTimeoutMs: Number(process.env.CHANNEL_TIMEOUT_MS ?? 10000),
    maxAttempts: Number(process.env.DELIVERY_MAX_ATTEMPTS ?? 5),
    backoffBaseMs: Number(process.env.DELIVERY_BACKOFF_BASE_MS ?? 1000),
  },
  sentry: {
    dsn: process.env.SENTRY_DSN,
    environment: process.env.SENTRY_ENVIRONMENT ?? 'development',
  },
});
