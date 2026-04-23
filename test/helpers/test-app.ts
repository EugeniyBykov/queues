import { Test, TestingModule } from '@nestjs/testing';
import { BullModule } from '@nestjs/bullmq';
import { ConfigModule } from '@nestjs/config';
import { DeliveryModule } from '../../src/delivery/delivery.module';
import { QueuesModule } from '../../src/queues/queues.module';
import { DeadLetterModule } from '../../src/dead-letter/dead-letter.module';
import { DeliveryProcessor } from '../../src/queues/delivery.processor';
import { DeadLetterProcessor } from '../../src/dead-letter/dead-letter.processor';
import { DeadLetterRepository } from '../../src/dead-letter/dead-letter.repository';
import { getRepositoryToken } from '@nestjs/typeorm';
import { DeadLetterRecord } from '../../src/dead-letter/dead-letter.entity';

export interface FakeRepoState {
  records: Map<string, DeadLetterRecord>;
}

export const createFakeRepo = (state: FakeRepoState) => ({
  save: jest.fn(async (r: Partial<DeadLetterRecord>) => {
    const id = r.id ?? `r${state.records.size + 1}`;
    const saved = { ...r, id, createdAt: new Date() } as DeadLetterRecord;
    state.records.set(id, saved);
    return saved;
  }),
  findById: jest.fn(async (id: string) => state.records.get(id) ?? null),
  findPaginated: jest.fn(async () => ({
    items: [...state.records.values()],
    total: state.records.size,
  })),
  markResubmitted: jest.fn(async (id: string) => {
    const r = state.records.get(id);
    if (r)
      state.records.set(id, {
        ...r,
        status: 'resubmitted',
        resubmittedAt: new Date(),
      });
  }),
});

const fakeTypeOrmRepo = () => ({
  save: jest.fn(),
  findOneBy: jest.fn(),
  findAndCount: jest.fn(),
  update: jest.fn(),
});

export interface BuildTestAppOptions {
  env: Record<string, string>;
  redisHost: string;
  redisPort: number;
}

export async function buildTestApp(opts: BuildTestAppOptions): Promise<{
  module: TestingModule;
  state: FakeRepoState;
}> {
  const { env, redisHost, redisPort } = opts;
  Object.assign(process.env, env);
  const state: FakeRepoState = { records: new Map() };
  const module = await Test.createTestingModule({
    imports: [
      ConfigModule.forRoot({
        isGlobal: true,
        load: [
          () => ({
            app: { nodeEnv: 'test' },
            redis: { host: redisHost, port: redisPort },
            delivery: {
              internalServiceUrl:
                env.INTERNAL_SERVICE_URL ?? 'http://localhost:4001/internal',
              emailServiceUrl:
                env.EMAIL_SERVICE_URL ?? 'http://localhost:4002/email',
              channelTimeoutMs: 1000,
              maxAttempts: Number(env.DELIVERY_MAX_ATTEMPTS ?? 3),
              backoffBaseMs: Number(env.DELIVERY_BACKOFF_BASE_MS ?? 10),
            },
          }),
        ],
      }),
      BullModule.forRoot({
        connection: { host: redisHost, port: redisPort },
      }),
      DeliveryModule,
      QueuesModule,
      DeadLetterModule,
    ],
    providers: [DeliveryProcessor, DeadLetterProcessor],
  })
    .overrideProvider(getRepositoryToken(DeadLetterRecord))
    .useValue(fakeTypeOrmRepo())
    .overrideProvider(DeadLetterRepository)
    .useValue(createFakeRepo(state))
    .compile();
  return { module, state };
}
