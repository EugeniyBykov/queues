import 'reflect-metadata';
import { validate } from './config.validation';

const completeEnv = {
  NODE_ENV: 'test',
  PORT: 3000,
  DB_HOST: 'localhost',
  DB_PORT: 5432,
  DB_USER: 'u',
  DB_PASSWORD: 'p',
  DB_NAME: 'q',
  REDIS_HOST: 'localhost',
  REDIS_PORT: 6379,
  INTERNAL_SERVICE_URL: 'http://localhost:4001/internal',
  EMAIL_SERVICE_URL: 'http://localhost:4002/email',
  CHANNEL_TIMEOUT_MS: 10000,
  DELIVERY_MAX_ATTEMPTS: 5,
  DELIVERY_BACKOFF_BASE_MS: 1000,
};

describe('validate (env)', () => {
  it('accepts a fully populated env', () => {
    expect(() => validate(completeEnv)).not.toThrow();
  });

  it('coerces numeric strings to numbers', () => {
    const result = validate({
      ...completeEnv,
      PORT: '3000',
      DELIVERY_MAX_ATTEMPTS: '5',
    });
    expect(result.PORT).toBe(3000);
    expect(result.DELIVERY_MAX_ATTEMPTS).toBe(5);
  });

  it('rejects non-numeric values for numeric fields', () => {
    expect(() => validate({ ...completeEnv, PORT: 'abc' })).toThrow();
    expect(() =>
      validate({ ...completeEnv, DELIVERY_MAX_ATTEMPTS: 'not-a-number' }),
    ).toThrow();
  });

  it.each([
    'DB_HOST',
    'DB_USER',
    'DB_PASSWORD',
    'DB_NAME',
    'REDIS_HOST',
    'INTERNAL_SERVICE_URL',
    'EMAIL_SERVICE_URL',
  ])('throws when required field %s is missing', (key) => {
    const env = { ...completeEnv } as Record<string, unknown>;
    delete env[key];
    expect(() => validate(env)).toThrow();
  });

  it('throws when a required field is an empty string', () => {
    expect(() => validate({ ...completeEnv, DB_PASSWORD: '' })).toThrow();
  });

  it('accepts an env missing only optional tunables', () => {
    const env = { ...completeEnv } as Record<string, unknown>;
    delete env.PORT;
    delete env.CHANNEL_TIMEOUT_MS;
    delete env.DELIVERY_MAX_ATTEMPTS;
    delete env.DELIVERY_BACKOFF_BASE_MS;
    expect(() => validate(env)).not.toThrow();
  });
});
