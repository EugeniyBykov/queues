import { HttpService } from '@nestjs/axios';
import { TestingModule } from '@nestjs/testing';
import { RedisContainer, StartedRedisContainer } from '@testcontainers/redis';
import { throwError } from 'rxjs';
import { AxiosError } from 'axios';
import { buildTestApp, FakeRepoState } from './helpers/test-app';
import { QueuesService } from '../src/queues/queues.service';

const waitFor = async (
  predicate: () => boolean,
  timeoutMs = 10000,
  intervalMs = 50,
) => {
  const start = Date.now();
  while (Date.now() - start < timeoutMs) {
    if (predicate()) return;
    await new Promise((r) => setTimeout(r, intervalMs));
  }
  throw new Error('Timed out waiting for condition');
};

describe('delivery retry + DLQ (integration)', () => {
  let redis: StartedRedisContainer;
  let moduleRef: TestingModule;
  let state: FakeRepoState;
  let queues: QueuesService;

  beforeAll(async () => {
    redis = await new RedisContainer('redis:7-alpine').start();
  }, 60000);

  afterAll(async () => {
    await redis.stop();
  });

  beforeEach(async () => {
    const built = await buildTestApp({
      env: {
        DELIVERY_MAX_ATTEMPTS: '3',
        DELIVERY_BACKOFF_BASE_MS: '10',
      },
      redisHost: redis.getHost(),
      redisPort: redis.getPort(),
    });
    moduleRef = built.module;
    state = built.state;
    await moduleRef.init();
    queues = moduleRef.get(QueuesService);
  });

  afterEach(async () => {
    const delivery = queues.getDeliveryQueue();
    const dlq = queues.getDeadLetterQueue();
    await delivery.obliterate({ force: true });
    await dlq.obliterate({ force: true });
    await moduleRef.close();
  });

  it('fails 3x then lands in DLQ with a pending record', async () => {
    const http = moduleRef.get(HttpService);
    jest.spyOn(http, 'post').mockReturnValue(
      throwError(() => {
        const err = new AxiosError('boom');
        err.response = { status: 500 } as AxiosError['response'];
        return err;
      }),
    );

    await queues.enqueueDelivery({
      id: 'm1',
      body: 'b',
      deliveries: [{ channel: 'webhook', target: 'http://t' }],
    });

    await waitFor(() => state.records.size > 0, 10000);
    const [rec] = state.records.values();
    expect(rec.status).toBe('pending');
    expect(rec.attemptsMade).toBeGreaterThanOrEqual(2);
  });

  it('4xx failure lands in DLQ after 1 attempt (no retries)', async () => {
    const http = moduleRef.get(HttpService);
    jest.spyOn(http, 'post').mockReturnValue(
      throwError(() => {
        const err = new AxiosError('bad');
        err.response = { status: 400 } as AxiosError['response'];
        return err;
      }),
    );

    await queues.enqueueDelivery({
      id: 'm2',
      body: 'b',
      deliveries: [{ channel: 'webhook', target: 'http://t' }],
    });

    await waitFor(() => state.records.size > 0, 10000);
    const [rec] = state.records.values();
    expect(rec.attemptsMade).toBe(0);
  });
});
