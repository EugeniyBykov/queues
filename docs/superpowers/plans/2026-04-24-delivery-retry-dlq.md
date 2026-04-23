# Delivery Retry & DLQ Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.
>
> **User preference:** Do **NOT** run `git commit` — prepare/stage but leave commits to the user. "Commit" steps in this plan mean "changes are ready for the user to commit".

**Goal:** Ship a NestJS service (split into API + worker processes) that delivers messages to webhook / internal-service / email channels with automatic retry + exponential backoff, persists terminally-failed jobs to Postgres, and exposes admin endpoints to inspect queues and resubmit dead-lettered messages.

**Architecture:** Single NestJS codebase with two entrypoints (`main.ts` for API, `main.worker.ts` for worker). Two BullMQ queues (`delivery`, `dead_letter`). BullMQ handles retry natively on the delivery queue; on terminal failure the processor publishes to `dead_letter` which persists a row to Postgres. Admin endpoints under a passthrough guard, documented via Swagger.

**Tech Stack:** NestJS 11, BullMQ 5 (`@nestjs/bullmq`), TypeORM (`@nestjs/typeorm` + `pg`), `@nestjs/axios`, `nest-winston` + `winston`, `@nestjs/swagger`, `ioredis-mock` (tests), Jest.

**Design spec:** `docs/superpowers/specs/2026-04-24-delivery-retry-dlq-design.md`

---

## File structure (target)

```
src/
├── main.ts                                        # API entry (modified)
├── main.worker.ts                                 # Worker entry (new)
├── app/
│   ├── api.module.ts                              # new — controllers + admin + swagger
│   └── worker.module.ts                           # new — processors only
├── admin/                                         # new
│   ├── admin.module.ts
│   ├── admin.guard.ts
│   ├── controllers/
│   │   ├── queue-admin.controller.ts
│   │   └── dead-letter-admin.controller.ts
│   └── dto/
│       ├── queue-stats.dto.ts
│       ├── job-status.dto.ts
│       ├── dead-letter-record.dto.ts
│       ├── pagination-query.dto.ts
│       └── resubmit-response.dto.ts
├── delivery/
│   ├── delivery.controller.ts                     # simplify imports
│   ├── delivery.module.ts                         # rewrite (shared module)
│   ├── delivery.service.ts                        # keep, add tests
│   ├── delivery.factory.ts                        # keep, add tests
│   ├── delivery.interface.ts                      # modify — drop retry types
│   ├── dto/create-delivery.dto.ts                 # keep
│   ├── errors/permanent-delivery.error.ts         # new
│   └── channels/
│       ├── webhook.channel.ts                     # rewrite — status check, timeout
│       ├── email.channel.ts                       # rewrite — real HTTP
│       └── internal-service.channel.ts            # rewrite — real HTTP
├── queues/
│   ├── queues.module.ts                           # new (replaces empty queue.module.ts)
│   ├── queues.service.ts                          # fix + simplify to 2 queues
│   ├── constants.ts                               # rewrite — 2 queues, 3 job names
│   └── delivery.processor.ts                      # moved from queues/deliver/
├── dead-letter/                                   # moved from queues/dead-letter/
│   ├── dead-letter.module.ts
│   ├── dead-letter.entity.ts                      # new
│   ├── dead-letter.repository.ts                  # new
│   ├── dead-letter.service.ts                     # modify — add publish + DB
│   └── dead-letter.processor.ts                   # modify — persist to DB
├── logger/
│   └── logger.module.ts                           # new — nest-winston
└── config/
    ├── configuration.ts                           # modify
    └── config.validation.ts                       # modify

test/
├── helpers/test-app.ts                            # new — ioredis-mock builder
└── delivery-retry.integration-spec.ts             # new

(deleted)
├── src/app.module.ts
├── src/queues/queue.module.ts
├── src/queues/retry/*
├── src/queues/deliver/*
└── src/queues/dead-letter/*
```

---

## Task 1: Install deps, clean stale files, baseline compile

**Files:**
- Modify: `package.json`
- Delete: `src/app.module.ts`, `src/queues/queue.module.ts`, `src/queues/retry/`, `src/queues/deliver/`, `src/queues/dead-letter/`

- [ ] **Step 1: Install new dependencies**

Run:
```
yarn add @nestjs/typeorm typeorm pg @nestjs/swagger nest-winston winston
yarn add -D ioredis-mock @types/ioredis-mock
```

- [ ] **Step 2: Delete stale files (content to be rewritten in later tasks)**

```
rm src/app.module.ts
rm -rf src/queues/queue.module.ts src/queues/retry src/queues/deliver src/queues/dead-letter
```

- [ ] **Step 3: Confirm workspace compiles to a known-broken state**

Run: `yarn tsc --noEmit 2>&1 | head -20`
Expected: errors about missing `AppModule` in `main.ts`, missing `../queues.service` in `delivery.controller.ts`. This is expected — baseline before rebuild.

- [ ] **Step 4: Commit**

Stage: `package.json`, `yarn.lock`, deletions. Ready for user to commit: `chore: add typeorm/swagger/winston deps, remove stale queue scaffolding`.

---

## Task 2: Config — new env vars + validation

**Files:**
- Modify: `.env.example`
- Modify: `src/config/configuration.ts`
- Modify: `src/config/config.validation.ts`
- Test: `src/config/config.validation.spec.ts`

- [ ] **Step 1: Update `.env.example`**

Append to `/Users/yevhen/PetProjects/queues/.env.example`:
```
INTERNAL_SERVICE_URL=http://localhost:4001/internal
EMAIL_SERVICE_URL=http://localhost:4002/email
CHANNEL_TIMEOUT_MS=10000
DELIVERY_MAX_ATTEMPTS=5
DELIVERY_BACKOFF_BASE_MS=1000
```

- [ ] **Step 2: Write the failing test**

Create `src/config/config.validation.spec.ts`:
```ts
import { validate } from './config.validation';

describe('validate (env)', () => {
  it('accepts a fully populated env', () => {
    expect(() =>
      validate({
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
      }),
    ).not.toThrow();
  });

  it('coerces numeric env vars via class-transformer', () => {
    const result = validate({ PORT: '3000', DELIVERY_MAX_ATTEMPTS: '5' } as any);
    expect(result.PORT).toBe('3000');
  });
});
```

- [ ] **Step 3: Run test, expect failure**

Run: `yarn test src/config/config.validation.spec.ts`
Expected: passes (existing validation is `IsOptional` on everything), but new fields aren't validated yet.

- [ ] **Step 4: Add new env fields to `src/config/config.validation.ts`**

Append inside the `EnvVariables` class:
```ts
  @IsOptional()
  @IsString()
  INTERNAL_SERVICE_URL?: string;

  @IsOptional()
  @IsString()
  EMAIL_SERVICE_URL?: string;

  @IsOptional()
  @IsNumber()
  CHANNEL_TIMEOUT_MS?: number;

  @IsOptional()
  @IsNumber()
  DELIVERY_MAX_ATTEMPTS?: number;

  @IsOptional()
  @IsNumber()
  DELIVERY_BACKOFF_BASE_MS?: number;
```

- [ ] **Step 5: Extend `src/config/configuration.ts`**

Replace the default export with:
```ts
export default () => ({
  app: {
    nodeEnv: process.env.NODE_ENV ?? 'development',
    port: Number(process.env.PORT ?? 3000),
  },
  database: {
    host: process.env.DB_HOST ?? 'localhost',
    port: Number(process.env.DB_PORT ?? 5432),
    user: process.env.DB_USER ?? 'postgres',
    password: process.env.DB_PASSWORD ?? 'postgres',
    name: process.env.DB_NAME ?? 'queues',
  },
  redis: {
    host: process.env.REDIS_HOST ?? 'localhost',
    port: Number(process.env.REDIS_PORT ?? 6379),
  },
  delivery: {
    internalServiceUrl: process.env.INTERNAL_SERVICE_URL ?? 'http://localhost:4001/internal',
    emailServiceUrl: process.env.EMAIL_SERVICE_URL ?? 'http://localhost:4002/email',
    channelTimeoutMs: Number(process.env.CHANNEL_TIMEOUT_MS ?? 10000),
    maxAttempts: Number(process.env.DELIVERY_MAX_ATTEMPTS ?? 5),
    backoffBaseMs: Number(process.env.DELIVERY_BACKOFF_BASE_MS ?? 1000),
  },
});
```

- [ ] **Step 6: Run test, expect pass**

Run: `yarn test src/config/config.validation.spec.ts`
Expected: both tests pass.

- [ ] **Step 7: Commit**

Ready for user to commit: `feat(config): add delivery and channel env vars`.

---

## Task 3: Logger — nest-winston module

**Files:**
- Create: `src/logger/logger.module.ts`

- [ ] **Step 1: Create the module**

```ts
// src/logger/logger.module.ts
import { Module } from '@nestjs/common';
import { WinstonModule } from 'nest-winston';
import * as winston from 'winston';

@Module({
  imports: [
    WinstonModule.forRootAsync({
      useFactory: () => ({
        level: process.env.LOG_LEVEL ?? 'info',
        transports: [
          new winston.transports.Console({
            format:
              process.env.NODE_ENV === 'production'
                ? winston.format.json()
                : winston.format.combine(
                    winston.format.colorize(),
                    winston.format.timestamp(),
                    winston.format.printf(
                      (info) =>
                        `${info.timestamp as string} ${info.level} [${(info.context as string) ?? 'app'}] ${info.message as string}`,
                    ),
                  ),
          }),
        ],
      }),
    }),
  ],
  exports: [WinstonModule],
})
export class LoggerModule {}
```

- [ ] **Step 2: Verify compiles**

Run: `yarn tsc --noEmit src/logger/logger.module.ts`
Expected: no errors (module is not yet wired anywhere — that's fine, happens in Task 15/16).

- [ ] **Step 3: Commit**

Ready for user to commit: `feat(logger): add winston-backed logger module`.

---

## Task 4: DLQ entity + repository + tests

**Files:**
- Create: `src/dead-letter/dead-letter.entity.ts`
- Create: `src/dead-letter/dead-letter.repository.ts`
- Test: `src/dead-letter/dead-letter.repository.spec.ts`

- [ ] **Step 1: Create the entity**

```ts
// src/dead-letter/dead-letter.entity.ts
import {
  Column,
  CreateDateColumn,
  Entity,
  PrimaryGeneratedColumn,
} from 'typeorm';
import type { DeliveryPayload } from '../delivery/delivery.interface';

export type DeadLetterStatus = 'pending' | 'resubmitted';

@Entity('dead_letter_records')
export class DeadLetterRecord {
  @PrimaryGeneratedColumn('uuid')
  id: string;

  @Column()
  originalJobId: string;

  @Column('jsonb')
  payload: DeliveryPayload;

  @Column('text', { array: true })
  channels: string[];

  @Column('text')
  reason: string;

  @Column('int')
  attemptsMade: number;

  @Column('timestamptz')
  failedAt: Date;

  @Column('timestamptz', { nullable: true })
  resubmittedAt: Date | null;

  @Column({ type: 'enum', enum: ['pending', 'resubmitted'], default: 'pending' })
  status: DeadLetterStatus;

  @CreateDateColumn()
  createdAt: Date;
}
```

- [ ] **Step 2: Write the failing repository test**

```ts
// src/dead-letter/dead-letter.repository.spec.ts
import { Repository } from 'typeorm';
import { DeadLetterRecord } from './dead-letter.entity';
import { DeadLetterRepository } from './dead-letter.repository';

describe('DeadLetterRepository', () => {
  let typeOrmRepo: jest.Mocked<Repository<DeadLetterRecord>>;
  let repo: DeadLetterRepository;

  beforeEach(() => {
    typeOrmRepo = {
      save: jest.fn(),
      findOneBy: jest.fn(),
      findAndCount: jest.fn(),
      update: jest.fn(),
      create: jest.fn((x) => x as DeadLetterRecord),
    } as unknown as jest.Mocked<Repository<DeadLetterRecord>>;
    repo = new DeadLetterRepository(typeOrmRepo);
  });

  it('save persists a new record', async () => {
    const record = { originalJobId: 'j1' } as DeadLetterRecord;
    typeOrmRepo.save.mockResolvedValue({ ...record, id: 'r1' } as DeadLetterRecord);
    const result = await repo.save(record);
    expect(result.id).toBe('r1');
    expect(typeOrmRepo.save).toHaveBeenCalledWith(record);
  });

  it('findById returns record or null', async () => {
    typeOrmRepo.findOneBy.mockResolvedValue(null);
    expect(await repo.findById('missing')).toBeNull();
  });

  it('findPaginated filters by status and applies limit/offset', async () => {
    typeOrmRepo.findAndCount.mockResolvedValue([[], 0]);
    await repo.findPaginated({ status: 'pending', limit: 10, offset: 20 });
    expect(typeOrmRepo.findAndCount).toHaveBeenCalledWith({
      where: { status: 'pending' },
      take: 10,
      skip: 20,
      order: { createdAt: 'DESC' },
    });
  });

  it('markResubmitted updates status + resubmittedAt', async () => {
    typeOrmRepo.update.mockResolvedValue({ affected: 1 } as any);
    await repo.markResubmitted('r1');
    expect(typeOrmRepo.update).toHaveBeenCalledWith(
      'r1',
      expect.objectContaining({ status: 'resubmitted' }),
    );
  });
});
```

- [ ] **Step 3: Run test — expect failure (repo doesn't exist)**

Run: `yarn test src/dead-letter/dead-letter.repository.spec.ts`
Expected: Cannot find module './dead-letter.repository'.

- [ ] **Step 4: Implement the repository**

```ts
// src/dead-letter/dead-letter.repository.ts
import { Injectable } from '@nestjs/common';
import { InjectRepository } from '@nestjs/typeorm';
import { Repository } from 'typeorm';
import { DeadLetterRecord, DeadLetterStatus } from './dead-letter.entity';

export interface FindPaginatedOptions {
  status?: DeadLetterStatus;
  limit: number;
  offset: number;
}

@Injectable()
export class DeadLetterRepository {
  constructor(
    @InjectRepository(DeadLetterRecord)
    private readonly repo: Repository<DeadLetterRecord>,
  ) {}

  save(record: Partial<DeadLetterRecord>): Promise<DeadLetterRecord> {
    return this.repo.save(record as DeadLetterRecord);
  }

  findById(id: string): Promise<DeadLetterRecord | null> {
    return this.repo.findOneBy({ id });
  }

  async findPaginated(
    options: FindPaginatedOptions,
  ): Promise<{ items: DeadLetterRecord[]; total: number }> {
    const where = options.status ? { status: options.status } : {};
    const [items, total] = await this.repo.findAndCount({
      where,
      take: options.limit,
      skip: options.offset,
      order: { createdAt: 'DESC' },
    });
    return { items, total };
  }

  async markResubmitted(id: string): Promise<void> {
    await this.repo.update(id, {
      status: 'resubmitted',
      resubmittedAt: new Date(),
    });
  }
}
```

- [ ] **Step 5: Run test — expect pass**

Run: `yarn test src/dead-letter/dead-letter.repository.spec.ts`
Expected: 4 tests pass.

- [ ] **Step 6: Commit**

Ready for user to commit: `feat(dead-letter): add DeadLetterRecord entity + repository`.

---

## Task 5: PermanentDeliveryError

**Files:**
- Create: `src/delivery/errors/permanent-delivery.error.ts`

- [ ] **Step 1: Create the error**

```ts
// src/delivery/errors/permanent-delivery.error.ts
import { UnrecoverableError } from 'bullmq';

export class PermanentDeliveryError extends UnrecoverableError {
  constructor(
    message: string,
    public readonly statusCode?: number,
  ) {
    super(message);
    this.name = 'PermanentDeliveryError';
  }
}
```

- [ ] **Step 2: Verify compiles**

Run: `yarn tsc --noEmit`
Expected: existing errors remain; no new errors from this file.

- [ ] **Step 3: Commit**

Ready for user to commit: `feat(delivery): add PermanentDeliveryError`.

---

## Task 6: Webhook channel rewrite + tests

**Files:**
- Modify: `src/delivery/delivery.interface.ts` (remove `RetryPayload`, keep `DeadLetterPayload` and others)
- Replace: `src/delivery/channels/webhook-channel.ts` → `src/delivery/channels/webhook.channel.ts`
- Test: `src/delivery/channels/webhook.channel.spec.ts`

- [ ] **Step 1: Rename and clean up the interface file**

Replace `src/delivery/delivery.interface.ts` with:
```ts
export type DeliveryChannel = 'webhook' | 'internal-service' | 'email';

export interface DeliveryTarget {
  channel: DeliveryChannel;
  target: string;
}

export interface DeliveryPayload {
  id: string;
  deliveries: DeliveryTarget[];
  subject?: string;
  body: string;
  metadata?: Record<string, unknown>;
}

export interface DeliveryResult {
  success: boolean;
  channel: DeliveryChannel;
  target: string;
  message?: string;
}

export type BasePayload = Omit<DeliveryPayload, 'deliveries'>;

export interface DeliveryChannelHandler {
  canHandle(channel: DeliveryChannel): boolean;
  deliver(target: string, payload: BasePayload): Promise<DeliveryResult>;
}

export interface DeadLetterPayload {
  originalJobId: string;
  payload: DeliveryPayload;
  reason: string;
  channels: DeliveryChannel[];
  attemptsMade: number;
  failedAt: string;
}
```

- [ ] **Step 2: Delete old webhook file and write the failing test**

```
rm src/delivery/channels/webhook-channel.ts
```

Create `src/delivery/channels/webhook.channel.spec.ts`:
```ts
import { HttpService } from '@nestjs/axios';
import { ConfigService } from '@nestjs/config';
import { AxiosError, AxiosResponse } from 'axios';
import { of, throwError } from 'rxjs';
import { PermanentDeliveryError } from '../errors/permanent-delivery.error';
import { WebhookChannel } from './webhook.channel';

const response = (status: number): AxiosResponse =>
  ({ status, data: {}, headers: {}, config: {} as any, statusText: '' }) as AxiosResponse;

const axiosError = (status: number): AxiosError =>
  Object.assign(new AxiosError('http error'), {
    response: { status } as any,
    isAxiosError: true,
  });

describe('WebhookChannel', () => {
  let http: { post: jest.Mock };
  let config: { get: jest.Mock };
  let channel: WebhookChannel;

  beforeEach(() => {
    http = { post: jest.fn() };
    config = { get: jest.fn().mockReturnValue(10000) };
    channel = new WebhookChannel(http as unknown as HttpService, config as unknown as ConfigService);
  });

  it('canHandle returns true for webhook only', () => {
    expect(channel.canHandle('webhook')).toBe(true);
    expect(channel.canHandle('email')).toBe(false);
  });

  it('POSTs with expected body and returns success on 2xx', async () => {
    http.post.mockReturnValue(of(response(200)));
    const result = await channel.deliver('http://target/webhook', {
      id: 'm1',
      body: 'hi',
      subject: 's',
      metadata: { a: 1 },
    });
    expect(http.post).toHaveBeenCalledWith(
      'http://target/webhook',
      { id: 'm1', body: 'hi', subject: 's', metadata: { a: 1 } },
      expect.objectContaining({ timeout: 10000 }),
    );
    expect(result.success).toBe(true);
  });

  it('throws PermanentDeliveryError on 4xx', async () => {
    http.post.mockReturnValue(throwError(() => axiosError(404)));
    await expect(
      channel.deliver('http://t', { id: 'm1', body: 'b' }),
    ).rejects.toBeInstanceOf(PermanentDeliveryError);
  });

  it('throws plain Error on 5xx (retryable)', async () => {
    http.post.mockReturnValue(throwError(() => axiosError(500)));
    await expect(channel.deliver('http://t', { id: 'm1', body: 'b' })).rejects.toThrow();
    await expect(
      channel.deliver('http://t', { id: 'm1', body: 'b' }),
    ).rejects.not.toBeInstanceOf(PermanentDeliveryError);
  });

  it('throws plain Error on timeout / network error', async () => {
    http.post.mockReturnValue(
      throwError(() => Object.assign(new AxiosError('timeout'), { code: 'ECONNABORTED' })),
    );
    await expect(
      channel.deliver('http://t', { id: 'm1', body: 'b' }),
    ).rejects.not.toBeInstanceOf(PermanentDeliveryError);
  });
});
```

- [ ] **Step 3: Run test — expect failure**

Run: `yarn test src/delivery/channels/webhook.channel.spec.ts`
Expected: Cannot find module './webhook.channel'.

- [ ] **Step 4: Implement the new webhook channel**

```ts
// src/delivery/channels/webhook.channel.ts
import { Injectable, Logger } from '@nestjs/common';
import { HttpService } from '@nestjs/axios';
import { ConfigService } from '@nestjs/config';
import { AxiosError } from 'axios';
import { firstValueFrom } from 'rxjs';
import {
  BasePayload,
  DeliveryChannel,
  DeliveryChannelHandler,
  DeliveryResult,
} from '../delivery.interface';
import { PermanentDeliveryError } from '../errors/permanent-delivery.error';

@Injectable()
export class WebhookChannel implements DeliveryChannelHandler {
  private readonly logger = new Logger(WebhookChannel.name);

  constructor(
    private readonly http: HttpService,
    private readonly config: ConfigService,
  ) {}

  canHandle(channel: DeliveryChannel): boolean {
    return channel === 'webhook';
  }

  async deliver(target: string, payload: BasePayload): Promise<DeliveryResult> {
    const timeout = this.config.get<number>('delivery.channelTimeoutMs') ?? 10000;
    try {
      await firstValueFrom(
        this.http.post(
          target,
          {
            id: payload.id,
            body: payload.body,
            subject: payload.subject,
            metadata: payload.metadata,
          },
          { timeout },
        ),
      );
      this.logger.log(`webhook delivered id=${payload.id} target=${target}`);
      return { success: true, channel: 'webhook', target };
    } catch (err) {
      const status = err instanceof AxiosError ? err.response?.status : undefined;
      this.logger.error(
        `webhook failed id=${payload.id} target=${target} status=${status ?? 'n/a'}`,
      );
      if (status && status >= 400 && status < 500) {
        throw new PermanentDeliveryError(
          `Webhook ${target} returned ${status}`,
          status,
        );
      }
      throw err instanceof Error ? err : new Error(String(err));
    }
  }
}
```

- [ ] **Step 5: Run test — expect pass**

Run: `yarn test src/delivery/channels/webhook.channel.spec.ts`
Expected: 5 tests pass.

- [ ] **Step 6: Commit**

Ready for user to commit: `feat(delivery): webhook channel with status check + timeout`.

---

## Task 7: Email + internal-service channels — real HTTP

**Files:**
- Replace: `src/delivery/channels/email.channel.ts`
- Replace: `src/delivery/channels/internal-service.channel.ts`
- Test: `src/delivery/channels/email.channel.spec.ts`
- Test: `src/delivery/channels/internal-service.channel.spec.ts`

- [ ] **Step 1: Write the failing email test**

```ts
// src/delivery/channels/email.channel.spec.ts
import { HttpService } from '@nestjs/axios';
import { ConfigService } from '@nestjs/config';
import { AxiosError, AxiosResponse } from 'axios';
import { of, throwError } from 'rxjs';
import { PermanentDeliveryError } from '../errors/permanent-delivery.error';
import { EmailChannel } from './email.channel';

const response = (status: number): AxiosResponse =>
  ({ status, data: {}, headers: {}, config: {} as any, statusText: '' }) as AxiosResponse;

describe('EmailChannel', () => {
  let http: { post: jest.Mock };
  let config: { get: jest.Mock };
  let channel: EmailChannel;

  beforeEach(() => {
    http = { post: jest.fn() };
    config = {
      get: jest.fn((key: string) =>
        key === 'delivery.emailServiceUrl' ? 'http://mail-svc/send' : 10000,
      ),
    };
    channel = new EmailChannel(http as unknown as HttpService, config as unknown as ConfigService);
  });

  it('canHandle returns true for email', () => {
    expect(channel.canHandle('email')).toBe(true);
  });

  it('POSTs to configured URL with { to: target } body', async () => {
    http.post.mockReturnValue(of(response(202)));
    await channel.deliver('alice@example.com', {
      id: 'm1',
      body: 'hi',
      subject: 'hello',
    });
    expect(http.post).toHaveBeenCalledWith(
      'http://mail-svc/send',
      { to: 'alice@example.com', id: 'm1', body: 'hi', subject: 'hello', metadata: undefined },
      expect.objectContaining({ timeout: 10000 }),
    );
  });

  it('throws PermanentDeliveryError on 4xx', async () => {
    http.post.mockReturnValue(
      throwError(() =>
        Object.assign(new AxiosError('bad'), { response: { status: 400 } as any }),
      ),
    );
    await expect(
      channel.deliver('alice@example.com', { id: 'm1', body: 'b' }),
    ).rejects.toBeInstanceOf(PermanentDeliveryError);
  });
});
```

- [ ] **Step 2: Write the failing internal-service test**

```ts
// src/delivery/channels/internal-service.channel.spec.ts
import { HttpService } from '@nestjs/axios';
import { ConfigService } from '@nestjs/config';
import { AxiosResponse } from 'axios';
import { of } from 'rxjs';
import { InternalServiceChannel } from './internal-service.channel';

const response = (status: number): AxiosResponse =>
  ({ status, data: {}, headers: {}, config: {} as any, statusText: '' }) as AxiosResponse;

describe('InternalServiceChannel', () => {
  let http: { post: jest.Mock };
  let config: { get: jest.Mock };
  let channel: InternalServiceChannel;

  beforeEach(() => {
    http = { post: jest.fn() };
    config = {
      get: jest.fn((key: string) =>
        key === 'delivery.internalServiceUrl' ? 'http://internal/api' : 10000,
      ),
    };
    channel = new InternalServiceChannel(
      http as unknown as HttpService,
      config as unknown as ConfigService,
    );
  });

  it('canHandle returns true for internal-service', () => {
    expect(channel.canHandle('internal-service')).toBe(true);
  });

  it('POSTs to configured URL with target + payload in body', async () => {
    http.post.mockReturnValue(of(response(200)));
    await channel.deliver('notifications', { id: 'm1', body: 'hi' });
    expect(http.post).toHaveBeenCalledWith(
      'http://internal/api',
      { target: 'notifications', id: 'm1', body: 'hi', subject: undefined, metadata: undefined },
      expect.objectContaining({ timeout: 10000 }),
    );
  });
});
```

- [ ] **Step 3: Run tests — expect failure**

Run: `yarn test src/delivery/channels/email.channel.spec.ts src/delivery/channels/internal-service.channel.spec.ts`
Expected: both fail with module-not-found / type mismatch.

- [ ] **Step 4: Implement EmailChannel**

```ts
// src/delivery/channels/email.channel.ts
import { Injectable, Logger } from '@nestjs/common';
import { HttpService } from '@nestjs/axios';
import { ConfigService } from '@nestjs/config';
import { AxiosError } from 'axios';
import { firstValueFrom } from 'rxjs';
import {
  BasePayload,
  DeliveryChannel,
  DeliveryChannelHandler,
  DeliveryResult,
} from '../delivery.interface';
import { PermanentDeliveryError } from '../errors/permanent-delivery.error';

@Injectable()
export class EmailChannel implements DeliveryChannelHandler {
  private readonly logger = new Logger(EmailChannel.name);

  constructor(
    private readonly http: HttpService,
    private readonly config: ConfigService,
  ) {}

  canHandle(channel: DeliveryChannel): boolean {
    return channel === 'email';
  }

  async deliver(target: string, payload: BasePayload): Promise<DeliveryResult> {
    const url = this.config.get<string>('delivery.emailServiceUrl')!;
    const timeout = this.config.get<number>('delivery.channelTimeoutMs') ?? 10000;
    try {
      await firstValueFrom(
        this.http.post(
          url,
          {
            to: target,
            id: payload.id,
            body: payload.body,
            subject: payload.subject,
            metadata: payload.metadata,
          },
          { timeout },
        ),
      );
      this.logger.log(`email delivered id=${payload.id} to=${target}`);
      return { success: true, channel: 'email', target };
    } catch (err) {
      const status = err instanceof AxiosError ? err.response?.status : undefined;
      this.logger.error(`email failed id=${payload.id} to=${target} status=${status ?? 'n/a'}`);
      if (status && status >= 400 && status < 500) {
        throw new PermanentDeliveryError(`Email service returned ${status}`, status);
      }
      throw err instanceof Error ? err : new Error(String(err));
    }
  }
}
```

- [ ] **Step 5: Implement InternalServiceChannel**

```ts
// src/delivery/channels/internal-service.channel.ts
import { Injectable, Logger } from '@nestjs/common';
import { HttpService } from '@nestjs/axios';
import { ConfigService } from '@nestjs/config';
import { AxiosError } from 'axios';
import { firstValueFrom } from 'rxjs';
import {
  BasePayload,
  DeliveryChannel,
  DeliveryChannelHandler,
  DeliveryResult,
} from '../delivery.interface';
import { PermanentDeliveryError } from '../errors/permanent-delivery.error';

@Injectable()
export class InternalServiceChannel implements DeliveryChannelHandler {
  private readonly logger = new Logger(InternalServiceChannel.name);

  constructor(
    private readonly http: HttpService,
    private readonly config: ConfigService,
  ) {}

  canHandle(channel: DeliveryChannel): boolean {
    return channel === 'internal-service';
  }

  async deliver(target: string, payload: BasePayload): Promise<DeliveryResult> {
    const url = this.config.get<string>('delivery.internalServiceUrl')!;
    const timeout = this.config.get<number>('delivery.channelTimeoutMs') ?? 10000;
    try {
      await firstValueFrom(
        this.http.post(
          url,
          {
            target,
            id: payload.id,
            body: payload.body,
            subject: payload.subject,
            metadata: payload.metadata,
          },
          { timeout },
        ),
      );
      this.logger.log(`internal-service delivered id=${payload.id} target=${target}`);
      return { success: true, channel: 'internal-service', target };
    } catch (err) {
      const status = err instanceof AxiosError ? err.response?.status : undefined;
      this.logger.error(
        `internal-service failed id=${payload.id} target=${target} status=${status ?? 'n/a'}`,
      );
      if (status && status >= 400 && status < 500) {
        throw new PermanentDeliveryError(`Internal service returned ${status}`, status);
      }
      throw err instanceof Error ? err : new Error(String(err));
    }
  }
}
```

- [ ] **Step 6: Run tests — expect pass**

Run: `yarn test src/delivery/channels/`
Expected: all channel tests pass (webhook + email + internal).

- [ ] **Step 7: Commit**

Ready for user to commit: `feat(delivery): email + internal-service channels make real HTTP calls`.

---

## Task 8: DeliveryService + DeliveryFactory tests

**Files:**
- Test: `src/delivery/delivery.service.spec.ts`
- Test: `src/delivery/delivery.factory.spec.ts`
- Modify: `src/delivery/delivery.service.ts` (minor — update return type to include channel/target)

- [ ] **Step 1: Write DeliveryFactory test**

```ts
// src/delivery/delivery.factory.spec.ts
import { DeliveryFactory } from './delivery.factory';
import { DeliveryChannelHandler } from './delivery.interface';

const makeHandler = (name: string): DeliveryChannelHandler =>
  ({
    canHandle: (c) => c === name,
    deliver: jest.fn(),
  }) as unknown as DeliveryChannelHandler;

describe('DeliveryFactory', () => {
  it('returns the handler matching the channel', () => {
    const webhook = makeHandler('webhook');
    const factory = new DeliveryFactory([webhook, makeHandler('email')]);
    expect(factory.getHandler('webhook')).toBe(webhook);
  });

  it('throws when no handler matches', () => {
    const factory = new DeliveryFactory([makeHandler('webhook')]);
    expect(() => factory.getHandler('email')).toThrow(
      /Unsupported delivery channel: email/,
    );
  });
});
```

- [ ] **Step 2: Write DeliveryService test**

```ts
// src/delivery/delivery.service.spec.ts
import { DeliveryFactory } from './delivery.factory';
import { DeliveryService } from './delivery.service';
import { DeliveryChannelHandler, DeliveryPayload } from './delivery.interface';

describe('DeliveryService', () => {
  const payload: DeliveryPayload = {
    id: 'm1',
    body: 'b',
    deliveries: [
      { channel: 'webhook', target: 'http://t' },
      { channel: 'email', target: 'x@y' },
    ],
  };

  it('dispatches each delivery to its handler and aggregates results', async () => {
    const webhook = {
      canHandle: (c: string) => c === 'webhook',
      deliver: jest.fn().mockResolvedValue({ success: true, channel: 'webhook', target: 'http://t' }),
    };
    const email = {
      canHandle: (c: string) => c === 'email',
      deliver: jest.fn().mockResolvedValue({ success: true, channel: 'email', target: 'x@y' }),
    };
    const service = new DeliveryService(
      new DeliveryFactory([
        webhook as unknown as DeliveryChannelHandler,
        email as unknown as DeliveryChannelHandler,
      ]),
    );
    const results = await service.deliver(payload);
    expect(results).toHaveLength(2);
    expect(webhook.deliver).toHaveBeenCalledWith(
      'http://t',
      { id: 'm1', body: 'b', subject: undefined, metadata: undefined },
    );
    expect(email.deliver).toHaveBeenCalled();
  });

  it('propagates the first error (stops at failing channel)', async () => {
    const failing = {
      canHandle: () => true,
      deliver: jest.fn().mockRejectedValue(new Error('boom')),
    };
    const service = new DeliveryService(
      new DeliveryFactory([failing as unknown as DeliveryChannelHandler]),
    );
    await expect(service.deliver(payload)).rejects.toThrow('boom');
  });
});
```

- [ ] **Step 3: Run tests — expect pass (logic unchanged, types match)**

Run: `yarn test src/delivery/delivery.service.spec.ts src/delivery/delivery.factory.spec.ts`
Expected: both suites pass. If the service returns a `DeliveryResult` without `channel`/`target` properties, TypeScript will complain at the mock handler return values — update `src/delivery/delivery.service.ts` only if type errors appear: the service body doesn't need changes, only its imports (already OK).

- [ ] **Step 4: Commit**

Ready for user to commit: `test(delivery): add service + factory unit tests`.

---

## Task 9: Queue constants, QueuesService, QueuesModule

**Files:**
- Replace: `src/queues/constants.ts`
- Replace: `src/queues/queues.service.ts`
- Create: `src/queues/queues.module.ts`
- Test: `src/queues/queues.service.spec.ts`

- [ ] **Step 1: Replace constants**

```ts
// src/queues/constants.ts
export const QUEUES = {
  DELIVERY: 'delivery',
  DEAD_LETTER: 'dead_letter',
} as const;

export const JOB_NAMES = {
  DELIVER: 'deliver',
  RETRY: 'retry',
  DEAD_LETTER: 'dead_letter',
} as const;

export type QueueName = (typeof QUEUES)[keyof typeof QUEUES];
```

- [ ] **Step 2: Write the failing QueuesService test**

```ts
// src/queues/queues.service.spec.ts
import { ConfigService } from '@nestjs/config';
import { Queue } from 'bullmq';
import { QueuesService } from './queues.service';
import { JOB_NAMES } from './constants';
import { DeliveryPayload, DeadLetterPayload } from '../delivery/delivery.interface';

describe('QueuesService', () => {
  let delivery: jest.Mocked<Queue>;
  let deadLetter: jest.Mocked<Queue>;
  let config: ConfigService;
  let service: QueuesService;

  beforeEach(() => {
    delivery = { add: jest.fn().mockResolvedValue({ id: 'd1' }) } as unknown as jest.Mocked<Queue>;
    deadLetter = { add: jest.fn().mockResolvedValue({ id: 'x1' }) } as unknown as jest.Mocked<Queue>;
    config = {
      get: jest.fn((k: string) => (k === 'delivery.maxAttempts' ? 5 : 1000)),
    } as unknown as ConfigService;
    service = new QueuesService(delivery, deadLetter, config);
  });

  const payload: DeliveryPayload = {
    id: 'm1',
    body: 'b',
    deliveries: [{ channel: 'webhook', target: 'http://t' }],
  };

  it('enqueueDelivery adds a "deliver" job with attempts+backoff from config', async () => {
    await service.enqueueDelivery(payload);
    expect(delivery.add).toHaveBeenCalledWith(
      JOB_NAMES.DELIVER,
      payload,
      expect.objectContaining({
        attempts: 5,
        backoff: { type: 'exponential', delay: 1000 },
      }),
    );
  });

  it('enqueueRetry adds a "retry" job to the delivery queue', async () => {
    await service.enqueueRetry(payload);
    expect(delivery.add).toHaveBeenCalledWith(
      JOB_NAMES.RETRY,
      payload,
      expect.any(Object),
    );
  });

  it('enqueueDeadLetter adds a "dead_letter" job to the dead-letter queue', async () => {
    const dl: DeadLetterPayload = {
      originalJobId: 'j1',
      payload,
      reason: 'boom',
      channels: ['webhook'],
      attemptsMade: 5,
      failedAt: new Date().toISOString(),
    };
    await service.enqueueDeadLetter(dl);
    expect(deadLetter.add).toHaveBeenCalledWith(JOB_NAMES.DEAD_LETTER, dl);
  });
});
```

- [ ] **Step 3: Run test — expect failure**

Run: `yarn test src/queues/queues.service.spec.ts`
Expected: old service had 3 queues + different constants — fails to compile.

- [ ] **Step 4: Replace QueuesService**

```ts
// src/queues/queues.service.ts
import { Injectable } from '@nestjs/common';
import { InjectQueue } from '@nestjs/bullmq';
import { ConfigService } from '@nestjs/config';
import { Queue } from 'bullmq';
import { QUEUES, JOB_NAMES } from './constants';
import {
  DeadLetterPayload,
  DeliveryPayload,
} from '../delivery/delivery.interface';

@Injectable()
export class QueuesService {
  constructor(
    @InjectQueue(QUEUES.DELIVERY) private readonly deliveryQueue: Queue,
    @InjectQueue(QUEUES.DEAD_LETTER) private readonly deadLetterQueue: Queue,
    private readonly config: ConfigService,
  ) {}

  enqueueDelivery(payload: DeliveryPayload) {
    return this.deliveryQueue.add(JOB_NAMES.DELIVER, payload, this.deliveryOptions());
  }

  enqueueRetry(payload: DeliveryPayload) {
    return this.deliveryQueue.add(JOB_NAMES.RETRY, payload, this.deliveryOptions());
  }

  enqueueDeadLetter(payload: DeadLetterPayload) {
    return this.deadLetterQueue.add(JOB_NAMES.DEAD_LETTER, payload);
  }

  getDeliveryQueue(): Queue {
    return this.deliveryQueue;
  }

  getDeadLetterQueue(): Queue {
    return this.deadLetterQueue;
  }

  private deliveryOptions() {
    return {
      attempts: this.config.get<number>('delivery.maxAttempts') ?? 5,
      backoff: {
        type: 'exponential' as const,
        delay: this.config.get<number>('delivery.backoffBaseMs') ?? 1000,
      },
      removeOnComplete: true,
      removeOnFail: false,
    };
  }
}
```

- [ ] **Step 5: Create QueuesModule**

```ts
// src/queues/queues.module.ts
import { Module } from '@nestjs/common';
import { BullModule } from '@nestjs/bullmq';
import { QUEUES } from './constants';
import { QueuesService } from './queues.service';

@Module({
  imports: [
    BullModule.registerQueue({ name: QUEUES.DELIVERY }, { name: QUEUES.DEAD_LETTER }),
  ],
  providers: [QueuesService],
  exports: [QueuesService, BullModule],
})
export class QueuesModule {}
```

- [ ] **Step 6: Run test — expect pass**

Run: `yarn test src/queues/queues.service.spec.ts`
Expected: 3 tests pass.

- [ ] **Step 7: Commit**

Ready for user to commit: `feat(queues): QueuesService with delivery + dead-letter queues`.

---

## Task 10: DeadLetterService + DeadLetterModule + tests

**Files:**
- Replace: `src/dead-letter/dead-letter.service.ts`
- Replace: `src/dead-letter/dead-letter.module.ts`
- Test: `src/dead-letter/dead-letter.service.spec.ts`

- [ ] **Step 1: Write the failing test**

```ts
// src/dead-letter/dead-letter.service.spec.ts
import { Job } from 'bullmq';
import { DeliveryPayload } from '../delivery/delivery.interface';
import { DeadLetterService } from './dead-letter.service';
import { QueuesService } from '../queues/queues.service';

describe('DeadLetterService', () => {
  const payload: DeliveryPayload = {
    id: 'm1',
    body: 'b',
    deliveries: [{ channel: 'webhook', target: 'http://t' }],
  };

  let queues: jest.Mocked<QueuesService>;
  let service: DeadLetterService;

  beforeEach(() => {
    queues = {
      enqueueDeadLetter: jest.fn().mockResolvedValue({ id: 'x1' }),
    } as unknown as jest.Mocked<QueuesService>;
    service = new DeadLetterService(queues);
  });

  it('publish builds a payload from the job+error and enqueues to DLQ', async () => {
    const job = {
      id: 'j1',
      data: payload,
      attemptsMade: 5,
    } as unknown as Job<DeliveryPayload>;
    await service.publish(job, new Error('boom'));
    expect(queues.enqueueDeadLetter).toHaveBeenCalledWith(
      expect.objectContaining({
        originalJobId: 'j1',
        payload,
        reason: 'boom',
        channels: ['webhook'],
        attemptsMade: 5,
      }),
    );
  });

  it('falls back to "Unknown error" when error is not an Error instance', async () => {
    const job = {
      id: 'j2',
      data: payload,
      attemptsMade: 1,
    } as unknown as Job<DeliveryPayload>;
    await service.publish(job, 'weird');
    expect(queues.enqueueDeadLetter).toHaveBeenCalledWith(
      expect.objectContaining({ reason: 'Unknown error' }),
    );
  });
});
```

- [ ] **Step 2: Run test — expect failure (old service has different API)**

Run: `yarn test src/dead-letter/dead-letter.service.spec.ts`
Expected: fails — old service has `buildPayload`, not `publish`.

- [ ] **Step 3: Replace DeadLetterService**

```ts
// src/dead-letter/dead-letter.service.ts
import { Injectable, Logger } from '@nestjs/common';
import { Job } from 'bullmq';
import {
  DeadLetterPayload,
  DeliveryPayload,
} from '../delivery/delivery.interface';
import { QueuesService } from '../queues/queues.service';

@Injectable()
export class DeadLetterService {
  private readonly logger = new Logger(DeadLetterService.name);

  constructor(private readonly queues: QueuesService) {}

  async publish(job: Job<DeliveryPayload>, error: unknown): Promise<void> {
    const reason = error instanceof Error ? error.message : 'Unknown error';
    const channels = job.data.deliveries.map((d) => d.channel);
    const payload: DeadLetterPayload = {
      originalJobId: String(job.id),
      payload: job.data,
      reason,
      channels,
      attemptsMade: job.attemptsMade,
      failedAt: new Date().toISOString(),
    };
    this.logger.error(
      `dead-letter published job=${job.id} channels=${channels.join(',')} reason="${reason}"`,
    );
    await this.queues.enqueueDeadLetter(payload);
  }
}
```

- [ ] **Step 4: Replace DeadLetterModule**

```ts
// src/dead-letter/dead-letter.module.ts
import { Module } from '@nestjs/common';
import { TypeOrmModule } from '@nestjs/typeorm';
import { DeadLetterRecord } from './dead-letter.entity';
import { DeadLetterRepository } from './dead-letter.repository';
import { DeadLetterService } from './dead-letter.service';
import { QueuesModule } from '../queues/queues.module';

@Module({
  imports: [TypeOrmModule.forFeature([DeadLetterRecord]), QueuesModule],
  providers: [DeadLetterService, DeadLetterRepository],
  exports: [DeadLetterService, DeadLetterRepository, TypeOrmModule],
})
export class DeadLetterModule {}
```

- [ ] **Step 5: Run test — expect pass**

Run: `yarn test src/dead-letter/dead-letter.service.spec.ts`
Expected: 2 tests pass.

- [ ] **Step 6: Commit**

Ready for user to commit: `feat(dead-letter): service publishes failed jobs to DLQ queue`.

---

## Task 11: DeadLetterProcessor — persist to DB + tests

**Files:**
- Replace: `src/dead-letter/dead-letter.processor.ts`
- Test: `src/dead-letter/dead-letter.processor.spec.ts`

- [ ] **Step 1: Write the failing test**

```ts
// src/dead-letter/dead-letter.processor.spec.ts
import { Job } from 'bullmq';
import { DeadLetterPayload } from '../delivery/delivery.interface';
import { DeadLetterProcessor } from './dead-letter.processor';
import { DeadLetterRepository } from './dead-letter.repository';

describe('DeadLetterProcessor', () => {
  const dl: DeadLetterPayload = {
    originalJobId: 'j1',
    payload: {
      id: 'm1',
      body: 'b',
      deliveries: [{ channel: 'webhook', target: 'http://t' }],
    },
    reason: 'boom',
    channels: ['webhook'],
    attemptsMade: 5,
    failedAt: '2026-04-24T00:00:00Z',
  };

  it('saves a record with status=pending', async () => {
    const repo = {
      save: jest.fn().mockResolvedValue({ id: 'r1' }),
    } as unknown as jest.Mocked<DeadLetterRepository>;
    const processor = new DeadLetterProcessor(repo);
    const result = await processor.process({ data: dl, id: 'x1' } as Job<DeadLetterPayload>);
    expect(repo.save).toHaveBeenCalledWith(
      expect.objectContaining({
        originalJobId: 'j1',
        reason: 'boom',
        channels: ['webhook'],
        attemptsMade: 5,
        status: 'pending',
        failedAt: expect.any(Date),
      }),
    );
    expect(result).toEqual({ recordId: 'r1' });
  });
});
```

- [ ] **Step 2: Run test — expect failure**

Run: `yarn test src/dead-letter/dead-letter.processor.spec.ts`
Expected: type/import errors — old processor just logs.

- [ ] **Step 3: Replace processor**

```ts
// src/dead-letter/dead-letter.processor.ts
import { Processor, WorkerHost } from '@nestjs/bullmq';
import { Logger } from '@nestjs/common';
import { Job } from 'bullmq';
import { QUEUES } from '../queues/constants';
import { DeadLetterPayload } from '../delivery/delivery.interface';
import { DeadLetterRepository } from './dead-letter.repository';

@Processor(QUEUES.DEAD_LETTER)
export class DeadLetterProcessor extends WorkerHost {
  private readonly logger = new Logger(DeadLetterProcessor.name);

  constructor(private readonly repo: DeadLetterRepository) {
    super();
  }

  async process(job: Job<DeadLetterPayload>): Promise<{ recordId: string }> {
    const record = await this.repo.save({
      originalJobId: job.data.originalJobId,
      payload: job.data.payload,
      channels: job.data.channels,
      reason: job.data.reason,
      attemptsMade: job.data.attemptsMade,
      failedAt: new Date(job.data.failedAt),
      resubmittedAt: null,
      status: 'pending',
    });
    this.logger.log(`dead-letter persisted id=${record.id} original=${job.data.originalJobId}`);
    return { recordId: record.id };
  }
}
```

- [ ] **Step 4: Run test — expect pass**

Run: `yarn test src/dead-letter/dead-letter.processor.spec.ts`
Expected: 1 test passes.

- [ ] **Step 5: Register processor in DeadLetterModule**

Edit `src/dead-letter/dead-letter.module.ts` — add `DeadLetterProcessor` to `providers`. Note: it's only needed on the worker side, but registering it here is fine — the ApiModule simply won't import `DeadLetterModule` in a way that starts the processor. Actually the cleanest path: **leave the processor out of `DeadLetterModule`**. Register it only in `WorkerModule` (Task 16).

Revert: remove `DeadLetterProcessor` from the DeadLetterModule providers list if you added it. It lives in `WorkerModule` only.

- [ ] **Step 6: Commit**

Ready for user to commit: `feat(dead-letter): processor persists DLQ records to Postgres`.

---

## Task 12: DeliveryProcessor — handle success / retry / permanent / DLQ trigger + tests

**Files:**
- Create: `src/queues/delivery.processor.ts`
- Test: `src/queues/delivery.processor.spec.ts`

- [ ] **Step 1: Write the failing test**

```ts
// src/queues/delivery.processor.spec.ts
import { Job, UnrecoverableError } from 'bullmq';
import { DeliveryPayload } from '../delivery/delivery.interface';
import { PermanentDeliveryError } from '../delivery/errors/permanent-delivery.error';
import { DeliveryService } from '../delivery/delivery.service';
import { DeadLetterService } from '../dead-letter/dead-letter.service';
import { DeliveryProcessor } from './delivery.processor';

const payload: DeliveryPayload = {
  id: 'm1',
  body: 'b',
  deliveries: [{ channel: 'webhook', target: 'http://t' }],
};

const makeJob = (attemptsMade: number, attempts: number): Job<DeliveryPayload> =>
  ({
    id: 'j1',
    data: payload,
    attemptsMade,
    opts: { attempts },
  }) as unknown as Job<DeliveryPayload>;

describe('DeliveryProcessor', () => {
  let delivery: jest.Mocked<DeliveryService>;
  let deadLetter: jest.Mocked<DeadLetterService>;
  let processor: DeliveryProcessor;

  beforeEach(() => {
    delivery = {
      deliver: jest.fn(),
    } as unknown as jest.Mocked<DeliveryService>;
    deadLetter = {
      publish: jest.fn().mockResolvedValue(undefined),
    } as unknown as jest.Mocked<DeadLetterService>;
    processor = new DeliveryProcessor(delivery, deadLetter);
  });

  it('returns delivery results on success', async () => {
    delivery.deliver.mockResolvedValue([
      { success: true, channel: 'webhook', target: 'http://t' },
    ]);
    const result = await processor.process(makeJob(0, 5));
    expect(result).toHaveLength(1);
    expect(deadLetter.publish).not.toHaveBeenCalled();
  });

  it('rethrows (no DLQ) on non-final retryable failure', async () => {
    delivery.deliver.mockRejectedValue(new Error('5xx'));
    await expect(processor.process(makeJob(2, 5))).rejects.toThrow('5xx');
    expect(deadLetter.publish).not.toHaveBeenCalled();
  });

  it('publishes to DLQ and rethrows on final attempt', async () => {
    delivery.deliver.mockRejectedValue(new Error('5xx'));
    await expect(processor.process(makeJob(4, 5))).rejects.toThrow('5xx');
    expect(deadLetter.publish).toHaveBeenCalledTimes(1);
  });

  it('publishes to DLQ immediately on PermanentDeliveryError (regardless of attempt)', async () => {
    delivery.deliver.mockRejectedValue(new PermanentDeliveryError('400', 400));
    await expect(processor.process(makeJob(0, 5))).rejects.toBeInstanceOf(UnrecoverableError);
    expect(deadLetter.publish).toHaveBeenCalledTimes(1);
  });
});
```

- [ ] **Step 2: Run test — expect failure**

Run: `yarn test src/queues/delivery.processor.spec.ts`
Expected: Cannot find module './delivery.processor'.

- [ ] **Step 3: Implement the processor**

```ts
// src/queues/delivery.processor.ts
import { Processor, WorkerHost } from '@nestjs/bullmq';
import { Logger } from '@nestjs/common';
import { Job } from 'bullmq';
import { QUEUES } from './constants';
import { DeliveryPayload, DeliveryResult } from '../delivery/delivery.interface';
import { DeliveryService } from '../delivery/delivery.service';
import { DeadLetterService } from '../dead-letter/dead-letter.service';
import { PermanentDeliveryError } from '../delivery/errors/permanent-delivery.error';

@Processor(QUEUES.DELIVERY)
export class DeliveryProcessor extends WorkerHost {
  private readonly logger = new Logger(DeliveryProcessor.name);

  constructor(
    private readonly delivery: DeliveryService,
    private readonly deadLetter: DeadLetterService,
  ) {
    super();
  }

  async process(job: Job<DeliveryPayload>): Promise<DeliveryResult[]> {
    try {
      return await this.delivery.deliver(job.data);
    } catch (err) {
      const maxAttempts = job.opts.attempts ?? 1;
      const isFinalAttempt = job.attemptsMade + 1 >= maxAttempts;
      const isPermanent = err instanceof PermanentDeliveryError;
      if (isPermanent || isFinalAttempt) {
        this.logger.error(
          `delivery terminal failure job=${job.id} permanent=${isPermanent} attemptsMade=${job.attemptsMade}`,
        );
        await this.deadLetter.publish(job, err);
      }
      throw err;
    }
  }
}
```

- [ ] **Step 4: Run test — expect pass**

Run: `yarn test src/queues/delivery.processor.spec.ts`
Expected: 4 tests pass.

- [ ] **Step 5: Commit**

Ready for user to commit: `feat(queues): delivery processor with retry+DLQ semantics`.

---

## Task 13: DeliveryModule (shared) + DeliveryController fix

**Files:**
- Replace: `src/delivery/delivery.module.ts`
- Modify: `src/delivery/delivery.controller.ts`

- [ ] **Step 1: Replace DeliveryModule (no controller, no processor — just shared pieces)**

```ts
// src/delivery/delivery.module.ts
import { Module } from '@nestjs/common';
import { HttpModule } from '@nestjs/axios';
import { ConfigModule } from '@nestjs/config';
import { DeliveryService } from './delivery.service';
import { DeliveryFactory } from './delivery.factory';
import { WebhookChannel } from './channels/webhook.channel';
import { EmailChannel } from './channels/email.channel';
import { InternalServiceChannel } from './channels/internal-service.channel';

const CHANNELS_TOKEN = 'DELIVERY_CHANNELS';

@Module({
  imports: [HttpModule, ConfigModule],
  providers: [
    WebhookChannel,
    EmailChannel,
    InternalServiceChannel,
    {
      provide: CHANNELS_TOKEN,
      useFactory: (w: WebhookChannel, e: EmailChannel, i: InternalServiceChannel) => [w, e, i],
      inject: [WebhookChannel, EmailChannel, InternalServiceChannel],
    },
    {
      provide: DeliveryFactory,
      useFactory: (channels) => new DeliveryFactory(channels),
      inject: [CHANNELS_TOKEN],
    },
    DeliveryService,
  ],
  exports: [DeliveryService, DeliveryFactory],
})
export class DeliveryModule {}
```

- [ ] **Step 2: Fix the controller's QueuesService import**

Replace contents of `src/delivery/delivery.controller.ts`:
```ts
import { Body, Controller, Post } from '@nestjs/common';
import { ApiOperation, ApiTags } from '@nestjs/swagger';
import { CreateDeliveryDto } from './dto/create-delivery.dto';
import { QueuesService } from '../queues/queues.service';

@ApiTags('deliveries')
@Controller('deliveries')
export class DeliveryController {
  constructor(private readonly queues: QueuesService) {}

  @Post()
  @ApiOperation({ summary: 'Enqueue a delivery job' })
  async create(@Body() body: CreateDeliveryDto) {
    const job = await this.queues.enqueueDelivery(body);
    return { jobId: job.id };
  }
}
```

- [ ] **Step 3: Verify compiles**

Run: `yarn tsc --noEmit 2>&1 | grep -E "delivery|queue" | head -20`
Expected: no errors in `src/delivery/*` or `src/queues/*` files.

- [ ] **Step 4: Commit**

Ready for user to commit: `refactor(delivery): clean module + controller imports`.

---

## Task 14: Admin — guard + DTOs + controllers + tests

**Files:**
- Create: `src/admin/admin.guard.ts`
- Create: `src/admin/dto/pagination-query.dto.ts`
- Create: `src/admin/dto/queue-stats.dto.ts`
- Create: `src/admin/dto/job-status.dto.ts`
- Create: `src/admin/dto/dead-letter-record.dto.ts`
- Create: `src/admin/dto/resubmit-response.dto.ts`
- Create: `src/admin/controllers/queue-admin.controller.ts`
- Create: `src/admin/controllers/dead-letter-admin.controller.ts`
- Create: `src/admin/admin.module.ts`
- Test: `src/admin/controllers/queue-admin.controller.spec.ts`
- Test: `src/admin/controllers/dead-letter-admin.controller.spec.ts`

- [ ] **Step 1: Create the guard**

```ts
// src/admin/admin.guard.ts
import { CanActivate, Injectable } from '@nestjs/common';

@Injectable()
export class AdminGuard implements CanActivate {
  canActivate(): boolean {
    // TODO(prod): validate admin JWT / API key here
    return true;
  }
}
```

- [ ] **Step 2: Create the DTOs**

```ts
// src/admin/dto/pagination-query.dto.ts
import { ApiPropertyOptional } from '@nestjs/swagger';
import { IsEnum, IsInt, IsOptional, Max, Min } from 'class-validator';
import { Type } from 'class-transformer';

export class PaginationQueryDto {
  @ApiPropertyOptional({ enum: ['pending', 'resubmitted'] })
  @IsOptional()
  @IsEnum(['pending', 'resubmitted'])
  status?: 'pending' | 'resubmitted';

  @ApiPropertyOptional({ default: 25 })
  @IsOptional()
  @Type(() => Number)
  @IsInt()
  @Min(1)
  @Max(200)
  limit: number = 25;

  @ApiPropertyOptional({ default: 0 })
  @IsOptional()
  @Type(() => Number)
  @IsInt()
  @Min(0)
  offset: number = 0;
}
```

```ts
// src/admin/dto/queue-stats.dto.ts
import { ApiProperty } from '@nestjs/swagger';

export class QueueStatsDto {
  @ApiProperty() waiting: number;
  @ApiProperty() active: number;
  @ApiProperty() delayed: number;
  @ApiProperty() failed: number;
  @ApiProperty() completed: number;
  @ApiProperty({ type: [Object] }) recentJobs: unknown[];
}
```

```ts
// src/admin/dto/job-status.dto.ts
import { ApiProperty } from '@nestjs/swagger';

export class JobStatusDto {
  @ApiProperty() id: string;
  @ApiProperty() name: string;
  @ApiProperty() data: unknown;
  @ApiProperty() attemptsMade: number;
  @ApiProperty() state: string;
  @ApiProperty({ required: false }) failedReason?: string;
  @ApiProperty() timestamp: number;
}
```

```ts
// src/admin/dto/dead-letter-record.dto.ts
import { ApiProperty } from '@nestjs/swagger';

export class DeadLetterRecordDto {
  @ApiProperty() id: string;
  @ApiProperty() originalJobId: string;
  @ApiProperty() reason: string;
  @ApiProperty({ type: [String] }) channels: string[];
  @ApiProperty() attemptsMade: number;
  @ApiProperty() failedAt: Date;
  @ApiProperty({ required: false, nullable: true }) resubmittedAt: Date | null;
  @ApiProperty() status: 'pending' | 'resubmitted';
  @ApiProperty() createdAt: Date;
  @ApiProperty() payload: unknown;
}
```

```ts
// src/admin/dto/resubmit-response.dto.ts
import { ApiProperty } from '@nestjs/swagger';

export class ResubmitResponseDto {
  @ApiProperty() jobId: string;
  @ApiProperty() status: 'resubmitted';
}
```

- [ ] **Step 3: Write the queue-admin test**

```ts
// src/admin/controllers/queue-admin.controller.spec.ts
import { BadRequestException, NotFoundException } from '@nestjs/common';
import { Queue } from 'bullmq';
import { QueuesService } from '../../queues/queues.service';
import { QueueAdminController } from './queue-admin.controller';

describe('QueueAdminController', () => {
  const makeQueue = (overrides: Partial<Queue> = {}): jest.Mocked<Queue> =>
    ({
      getWaitingCount: jest.fn().mockResolvedValue(1),
      getActiveCount: jest.fn().mockResolvedValue(2),
      getDelayedCount: jest.fn().mockResolvedValue(3),
      getFailedCount: jest.fn().mockResolvedValue(4),
      getCompletedCount: jest.fn().mockResolvedValue(5),
      getJobs: jest.fn().mockResolvedValue([{ id: 'j1', name: 'deliver' }]),
      getJob: jest.fn(),
      ...overrides,
    }) as unknown as jest.Mocked<Queue>;

  let delivery: jest.Mocked<Queue>;
  let deadLetter: jest.Mocked<Queue>;
  let queuesService: jest.Mocked<QueuesService>;
  let controller: QueueAdminController;

  beforeEach(() => {
    delivery = makeQueue();
    deadLetter = makeQueue();
    queuesService = {
      getDeliveryQueue: () => delivery,
      getDeadLetterQueue: () => deadLetter,
    } as unknown as jest.Mocked<QueuesService>;
    controller = new QueueAdminController(queuesService);
  });

  it('returns counts + recent jobs for a valid queue name', async () => {
    const stats = await controller.getQueue('delivery');
    expect(stats).toMatchObject({ waiting: 1, active: 2, completed: 5 });
    expect(stats.recentJobs).toHaveLength(1);
  });

  it('throws BadRequest for unknown queue name', async () => {
    await expect(controller.getQueue('nope' as any)).rejects.toBeInstanceOf(BadRequestException);
  });

  it('getJob returns job state', async () => {
    (delivery.getJob as jest.Mock).mockResolvedValue({
      id: 'j1',
      name: 'deliver',
      data: {},
      attemptsMade: 0,
      failedReason: undefined,
      timestamp: 1,
      getState: jest.fn().mockResolvedValue('waiting'),
    });
    const result = await controller.getJob('delivery', 'j1');
    expect(result.state).toBe('waiting');
  });

  it('getJob throws NotFound when job missing', async () => {
    (delivery.getJob as jest.Mock).mockResolvedValue(undefined);
    await expect(controller.getJob('delivery', 'missing')).rejects.toBeInstanceOf(NotFoundException);
  });
});
```

- [ ] **Step 4: Run queue-admin test — expect failure**

Run: `yarn test src/admin/controllers/queue-admin.controller.spec.ts`
Expected: module not found.

- [ ] **Step 5: Implement QueueAdminController**

```ts
// src/admin/controllers/queue-admin.controller.ts
import {
  BadRequestException,
  Controller,
  Get,
  NotFoundException,
  Param,
  UseGuards,
} from '@nestjs/common';
import { ApiOperation, ApiTags } from '@nestjs/swagger';
import { Queue } from 'bullmq';
import { QueuesService } from '../../queues/queues.service';
import { AdminGuard } from '../admin.guard';
import { QueueStatsDto } from '../dto/queue-stats.dto';
import { JobStatusDto } from '../dto/job-status.dto';

const KNOWN_QUEUES = ['delivery', 'dead_letter'] as const;
type KnownQueue = (typeof KNOWN_QUEUES)[number];

@ApiTags('admin')
@UseGuards(AdminGuard)
@Controller('admin/queues')
export class QueueAdminController {
  constructor(private readonly queues: QueuesService) {}

  @Get(':name')
  @ApiOperation({ summary: 'Queue counts and recent jobs' })
  async getQueue(@Param('name') name: string): Promise<QueueStatsDto> {
    const q = this.resolveQueue(name);
    const [waiting, active, delayed, failed, completed, recentJobs] = await Promise.all([
      q.getWaitingCount(),
      q.getActiveCount(),
      q.getDelayedCount(),
      q.getFailedCount(),
      q.getCompletedCount(),
      q.getJobs(['waiting', 'active', 'delayed', 'failed', 'completed'], 0, 19),
    ]);
    return {
      waiting,
      active,
      delayed,
      failed,
      completed,
      recentJobs: recentJobs.map((j) => ({
        id: j.id,
        name: j.name,
        attemptsMade: j.attemptsMade,
      })),
    };
  }

  @Get(':name/:jobId')
  @ApiOperation({ summary: 'Full job status' })
  async getJob(
    @Param('name') name: string,
    @Param('jobId') jobId: string,
  ): Promise<JobStatusDto> {
    const q = this.resolveQueue(name);
    const job = await q.getJob(jobId);
    if (!job) throw new NotFoundException(`Job ${jobId} not found in ${name}`);
    return {
      id: String(job.id),
      name: job.name,
      data: job.data,
      attemptsMade: job.attemptsMade,
      state: await job.getState(),
      failedReason: job.failedReason,
      timestamp: job.timestamp,
    };
  }

  private resolveQueue(name: string): Queue {
    if (!(KNOWN_QUEUES as readonly string[]).includes(name)) {
      throw new BadRequestException(
        `Unknown queue: ${name}. Valid: ${KNOWN_QUEUES.join(', ')}`,
      );
    }
    return (name as KnownQueue) === 'delivery'
      ? this.queues.getDeliveryQueue()
      : this.queues.getDeadLetterQueue();
  }
}
```

- [ ] **Step 6: Run queue-admin test — expect pass**

Run: `yarn test src/admin/controllers/queue-admin.controller.spec.ts`
Expected: 4 tests pass.

- [ ] **Step 7: Write dead-letter-admin test**

```ts
// src/admin/controllers/dead-letter-admin.controller.spec.ts
import { ConflictException, NotFoundException } from '@nestjs/common';
import { DeadLetterRecord } from '../../dead-letter/dead-letter.entity';
import { DeadLetterRepository } from '../../dead-letter/dead-letter.repository';
import { QueuesService } from '../../queues/queues.service';
import { DeadLetterAdminController } from './dead-letter-admin.controller';

const record = (overrides: Partial<DeadLetterRecord> = {}): DeadLetterRecord =>
  ({
    id: 'r1',
    originalJobId: 'j1',
    payload: { id: 'm1', body: 'b', deliveries: [] },
    channels: ['webhook'],
    reason: 'boom',
    attemptsMade: 5,
    failedAt: new Date(),
    resubmittedAt: null,
    status: 'pending',
    createdAt: new Date(),
    ...overrides,
  }) as DeadLetterRecord;

describe('DeadLetterAdminController', () => {
  let repo: jest.Mocked<DeadLetterRepository>;
  let queues: jest.Mocked<QueuesService>;
  let controller: DeadLetterAdminController;

  beforeEach(() => {
    repo = {
      findPaginated: jest.fn(),
      findById: jest.fn(),
      markResubmitted: jest.fn().mockResolvedValue(undefined),
    } as unknown as jest.Mocked<DeadLetterRepository>;
    queues = {
      enqueueRetry: jest.fn().mockResolvedValue({ id: 'newJob' }),
    } as unknown as jest.Mocked<QueuesService>;
    controller = new DeadLetterAdminController(repo, queues);
  });

  it('list returns paginated records', async () => {
    repo.findPaginated.mockResolvedValue({ items: [record()], total: 1 });
    const res = await controller.list({ limit: 25, offset: 0 });
    expect(res.items).toHaveLength(1);
    expect(res.total).toBe(1);
  });

  it('getOne 404s when missing', async () => {
    repo.findById.mockResolvedValue(null);
    await expect(controller.getOne('missing')).rejects.toBeInstanceOf(NotFoundException);
  });

  it('resubmit enqueues retry + marks record resubmitted', async () => {
    repo.findById.mockResolvedValue(record());
    const res = await controller.resubmit('r1');
    expect(queues.enqueueRetry).toHaveBeenCalled();
    expect(repo.markResubmitted).toHaveBeenCalledWith('r1');
    expect(res).toEqual({ jobId: 'newJob', status: 'resubmitted' });
  });

  it('resubmit 409s when already resubmitted', async () => {
    repo.findById.mockResolvedValue(record({ status: 'resubmitted' }));
    await expect(controller.resubmit('r1')).rejects.toBeInstanceOf(ConflictException);
  });

  it('resubmit 404s when record missing', async () => {
    repo.findById.mockResolvedValue(null);
    await expect(controller.resubmit('r1')).rejects.toBeInstanceOf(NotFoundException);
  });
});
```

- [ ] **Step 8: Run dead-letter-admin test — expect failure**

Run: `yarn test src/admin/controllers/dead-letter-admin.controller.spec.ts`
Expected: module not found.

- [ ] **Step 9: Implement DeadLetterAdminController**

```ts
// src/admin/controllers/dead-letter-admin.controller.ts
import {
  ConflictException,
  Controller,
  Get,
  NotFoundException,
  Param,
  Post,
  Query,
  UseGuards,
} from '@nestjs/common';
import { ApiOperation, ApiTags } from '@nestjs/swagger';
import { DeadLetterRepository } from '../../dead-letter/dead-letter.repository';
import { QueuesService } from '../../queues/queues.service';
import { AdminGuard } from '../admin.guard';
import { DeadLetterRecordDto } from '../dto/dead-letter-record.dto';
import { PaginationQueryDto } from '../dto/pagination-query.dto';
import { ResubmitResponseDto } from '../dto/resubmit-response.dto';

@ApiTags('admin')
@UseGuards(AdminGuard)
@Controller('admin/dead-letter')
export class DeadLetterAdminController {
  constructor(
    private readonly repo: DeadLetterRepository,
    private readonly queues: QueuesService,
  ) {}

  @Get()
  @ApiOperation({ summary: 'List dead-letter records' })
  async list(
    @Query() q: PaginationQueryDto,
  ): Promise<{ items: DeadLetterRecordDto[]; total: number }> {
    return this.repo.findPaginated(q);
  }

  @Get(':id')
  @ApiOperation({ summary: 'Get single dead-letter record' })
  async getOne(@Param('id') id: string): Promise<DeadLetterRecordDto> {
    const rec = await this.repo.findById(id);
    if (!rec) throw new NotFoundException(`DLQ record ${id} not found`);
    return rec;
  }

  @Post(':id/resubmit')
  @ApiOperation({ summary: 'Resubmit dead-letter record to delivery queue' })
  async resubmit(@Param('id') id: string): Promise<ResubmitResponseDto> {
    const rec = await this.repo.findById(id);
    if (!rec) throw new NotFoundException(`DLQ record ${id} not found`);
    if (rec.status === 'resubmitted') {
      throw new ConflictException(`DLQ record ${id} already resubmitted`);
    }
    const job = await this.queues.enqueueRetry(rec.payload);
    await this.repo.markResubmitted(id);
    return { jobId: String(job.id), status: 'resubmitted' };
  }
}
```

- [ ] **Step 10: Create AdminModule**

```ts
// src/admin/admin.module.ts
import { Module } from '@nestjs/common';
import { AdminGuard } from './admin.guard';
import { QueueAdminController } from './controllers/queue-admin.controller';
import { DeadLetterAdminController } from './controllers/dead-letter-admin.controller';
import { QueuesModule } from '../queues/queues.module';
import { DeadLetterModule } from '../dead-letter/dead-letter.module';

@Module({
  imports: [QueuesModule, DeadLetterModule],
  controllers: [QueueAdminController, DeadLetterAdminController],
  providers: [AdminGuard],
})
export class AdminModule {}
```

- [ ] **Step 11: Run dead-letter-admin test — expect pass**

Run: `yarn test src/admin/controllers/dead-letter-admin.controller.spec.ts`
Expected: 5 tests pass.

- [ ] **Step 12: Commit**

Ready for user to commit: `feat(admin): queue + dead-letter inspection and resubmit endpoints`.

---

## Task 15: ApiModule + main.ts + Swagger

**Files:**
- Create: `src/app/api.module.ts`
- Modify: `src/main.ts`

- [ ] **Step 1: Create ApiModule**

```ts
// src/app/api.module.ts
import { Module } from '@nestjs/common';
import { ConfigModule, ConfigService } from '@nestjs/config';
import { BullModule } from '@nestjs/bullmq';
import { TypeOrmModule } from '@nestjs/typeorm';
import configuration from '../config/configuration';
import { validate } from '../config/config.validation';
import { DeliveryModule } from '../delivery/delivery.module';
import { DeliveryController } from '../delivery/delivery.controller';
import { QueuesModule } from '../queues/queues.module';
import { DeadLetterModule } from '../dead-letter/dead-letter.module';
import { AdminModule } from '../admin/admin.module';
import { LoggerModule } from '../logger/logger.module';
import { DeadLetterRecord } from '../dead-letter/dead-letter.entity';

@Module({
  imports: [
    ConfigModule.forRoot({ isGlobal: true, load: [configuration], validate }),
    LoggerModule,
    BullModule.forRootAsync({
      inject: [ConfigService],
      useFactory: (c: ConfigService) => ({
        connection: {
          host: c.get<string>('redis.host'),
          port: c.get<number>('redis.port'),
        },
      }),
    }),
    TypeOrmModule.forRootAsync({
      inject: [ConfigService],
      useFactory: (c: ConfigService) => ({
        type: 'postgres',
        host: c.get<string>('database.host'),
        port: c.get<number>('database.port'),
        username: c.get<string>('database.user'),
        password: c.get<string>('database.password'),
        database: c.get<string>('database.name'),
        entities: [DeadLetterRecord],
        synchronize: c.get<string>('app.nodeEnv') !== 'production',
      }),
    }),
    DeliveryModule,
    QueuesModule,
    DeadLetterModule,
    AdminModule,
  ],
  controllers: [DeliveryController],
})
export class ApiModule {}
```

- [ ] **Step 2: Rewrite main.ts**

```ts
// src/main.ts
import { BadRequestException, ValidationPipe } from '@nestjs/common';
import { NestFactory } from '@nestjs/core';
import { DocumentBuilder, SwaggerModule } from '@nestjs/swagger';
import { WINSTON_MODULE_NEST_PROVIDER } from 'nest-winston';
import { ApiModule } from './app/api.module';

async function bootstrap() {
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

  const swaggerConfig = new DocumentBuilder()
    .setTitle('Queues API')
    .setDescription('Delivery + retry + DLQ admin')
    .setVersion('1.0')
    .build();
  SwaggerModule.setup('api/docs', app, SwaggerModule.createDocument(app, swaggerConfig));

  await app.listen(process.env.PORT ?? 3000);
}
bootstrap();
```

- [ ] **Step 3: Verify compiles**

Run: `yarn tsc --noEmit`
Expected: no errors.

- [ ] **Step 4: Smoke test (optional, requires Redis + Postgres running)**

Run: `yarn start` (in one terminal)
Expected: app boots, logs "Nest application successfully started", `/api/docs` serves Swagger. Kill with ctrl-c.
If Redis/Postgres aren't running, skip this step — integration test covers boot behavior.

- [ ] **Step 5: Commit**

Ready for user to commit: `feat(app): ApiModule + main.ts with swagger + winston`.

---

## Task 16: WorkerModule + main.worker.ts + package scripts

**Files:**
- Create: `src/app/worker.module.ts`
- Create: `src/main.worker.ts`
- Modify: `package.json`

- [ ] **Step 1: Create WorkerModule**

```ts
// src/app/worker.module.ts
import { Module } from '@nestjs/common';
import { ConfigModule, ConfigService } from '@nestjs/config';
import { BullModule } from '@nestjs/bullmq';
import { TypeOrmModule } from '@nestjs/typeorm';
import configuration from '../config/configuration';
import { validate } from '../config/config.validation';
import { DeliveryModule } from '../delivery/delivery.module';
import { QueuesModule } from '../queues/queues.module';
import { DeadLetterModule } from '../dead-letter/dead-letter.module';
import { LoggerModule } from '../logger/logger.module';
import { DeliveryProcessor } from '../queues/delivery.processor';
import { DeadLetterProcessor } from '../dead-letter/dead-letter.processor';
import { DeadLetterRecord } from '../dead-letter/dead-letter.entity';

@Module({
  imports: [
    ConfigModule.forRoot({ isGlobal: true, load: [configuration], validate }),
    LoggerModule,
    BullModule.forRootAsync({
      inject: [ConfigService],
      useFactory: (c: ConfigService) => ({
        connection: {
          host: c.get<string>('redis.host'),
          port: c.get<number>('redis.port'),
        },
      }),
    }),
    TypeOrmModule.forRootAsync({
      inject: [ConfigService],
      useFactory: (c: ConfigService) => ({
        type: 'postgres',
        host: c.get<string>('database.host'),
        port: c.get<number>('database.port'),
        username: c.get<string>('database.user'),
        password: c.get<string>('database.password'),
        database: c.get<string>('database.name'),
        entities: [DeadLetterRecord],
        synchronize: c.get<string>('app.nodeEnv') !== 'production',
      }),
    }),
    DeliveryModule,
    QueuesModule,
    DeadLetterModule,
  ],
  providers: [DeliveryProcessor, DeadLetterProcessor],
})
export class WorkerModule {}
```

- [ ] **Step 2: Create worker entrypoint**

```ts
// src/main.worker.ts
import { NestFactory } from '@nestjs/core';
import { WINSTON_MODULE_NEST_PROVIDER } from 'nest-winston';
import { WorkerModule } from './app/worker.module';

async function bootstrap() {
  const app = await NestFactory.createApplicationContext(WorkerModule, {
    bufferLogs: true,
  });
  app.useLogger(app.get(WINSTON_MODULE_NEST_PROVIDER));
  // processors run via @Processor decorators; no HTTP server here
  const logger = app.get(WINSTON_MODULE_NEST_PROVIDER);
  logger.log('Worker started', 'Bootstrap');

  // keep alive
  process.on('SIGTERM', () => {
    void app.close();
  });
}
bootstrap();
```

- [ ] **Step 3: Add package.json scripts**

Add under `"scripts"` in `package.json`:
```json
"start:worker": "nest start --entryFile main.worker",
"start:worker:dev": "nest start --entryFile main.worker --watch",
"start:worker:prod": "node dist/main.worker"
```

- [ ] **Step 4: Verify compiles**

Run: `yarn tsc --noEmit`
Expected: no errors.

- [ ] **Step 5: Commit**

Ready for user to commit: `feat(worker): separate worker entrypoint and module`.

---

## Task 17: docker-compose — two services + Postgres env

**Files:**
- Modify: `docker-compose.yml`
- Modify: `.env.example`

- [ ] **Step 1: Replace docker-compose.yml**

```yaml
services:
  api:
    build:
      context: .
      dockerfile: Dockerfile
    container_name: queues-api
    ports:
      - "${PORT}:3000"
    env_file: .env
    depends_on:
      db:
        condition: service_started
      redis:
        condition: service_started
    volumes:
      - .:/app
      - /app/node_modules
    command: yarn start:dev

  worker:
    build:
      context: .
      dockerfile: Dockerfile
    container_name: queues-worker
    env_file: .env
    depends_on:
      db:
        condition: service_started
      redis:
        condition: service_started
    volumes:
      - .:/app
      - /app/node_modules
    command: yarn start:worker:dev

  db:
    image: postgres:16-alpine
    container_name: queues-db
    ports:
      - "${DB_PORT}:5432"
    env_file: .env
    environment:
      POSTGRES_USER: ${DB_USER}
      POSTGRES_PASSWORD: ${DB_PASSWORD}
      POSTGRES_DB: ${DB_NAME}
    volumes:
      - postgres_data:/var/lib/postgresql/data

  redis:
    image: redis:7-alpine
    container_name: queues-redis
    ports:
      - "${REDIS_PORT}:6379"
    volumes:
      - redis_data:/data

volumes:
  postgres_data:
  redis_data:
```

- [ ] **Step 2: Simplify `.env.example`**

Replace contents with:
```
NODE_ENV=development
PORT=3000

DB_HOST=db
DB_PORT=5432
DB_USER=postgres
DB_PASSWORD=postgres
DB_NAME=queues

REDIS_HOST=redis
REDIS_PORT=6379

INTERNAL_SERVICE_URL=http://localhost:4001/internal
EMAIL_SERVICE_URL=http://localhost:4002/email
CHANNEL_TIMEOUT_MS=10000
DELIVERY_MAX_ATTEMPTS=5
DELIVERY_BACKOFF_BASE_MS=1000
```

(Drops `POSTGRES_*` duplicates — Postgres container now uses `DB_*` directly.)

- [ ] **Step 3: Commit**

Ready for user to commit: `chore(docker): split api and worker services`.

---

## Task 18: Integration test — BullMQ + ioredis-mock

**Files:**
- Create: `test/helpers/test-app.ts`
- Create: `test/delivery-retry.integration-spec.ts`
- Modify: `test/jest-e2e.json` (test regex)

- [ ] **Step 1: Check `test/jest-e2e.json` and make its regex accept `.integration-spec.ts`**

Read current `test/jest-e2e.json` and replace with:
```json
{
  "moduleFileExtensions": ["js", "json", "ts"],
  "rootDir": ".",
  "testEnvironment": "node",
  "testRegex": ".*\\.(e2e|integration)-spec\\.ts$",
  "transform": {
    "^.+\\.(t|j)s$": "ts-jest"
  }
}
```

Approach: mock `ioredis` module-wide via `jest.mock('ioredis', () => require('ioredis-mock'))` so BullMQ runs against in-memory Redis. Skip a real TypeORM setup and override `DeadLetterRepository` with an in-memory fake — sqlite doesn't support the entity's `jsonb` / `text[]` columns, and the integration test only needs to observe that DLQ records get saved.

- [ ] **Step 2: Create the test helper**

```ts
// test/helpers/test-app.ts
import { Test, TestingModule } from '@nestjs/testing';
import { BullModule } from '@nestjs/bullmq';
import { ConfigModule } from '@nestjs/config';
import { DeliveryModule } from '../../src/delivery/delivery.module';
import { QueuesModule } from '../../src/queues/queues.module';
import { DeadLetterModule } from '../../src/dead-letter/dead-letter.module';
import { DeliveryProcessor } from '../../src/queues/delivery.processor';
import { DeadLetterProcessor } from '../../src/dead-letter/dead-letter.processor';
import { DeadLetterRepository } from '../../src/dead-letter/dead-letter.repository';

export interface FakeRepoState {
  records: Map<string, any>;
}

export const createFakeRepo = (state: FakeRepoState) => ({
  save: jest.fn(async (r) => {
    const id = r.id ?? `r${state.records.size + 1}`;
    const saved = { ...r, id, createdAt: new Date() };
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
    if (r) state.records.set(id, { ...r, status: 'resubmitted', resubmittedAt: new Date() });
  }),
});

export async function buildTestApp(env: Record<string, string>): Promise<{
  module: TestingModule;
  state: FakeRepoState;
}> {
  Object.assign(process.env, env);
  const state: FakeRepoState = { records: new Map() };
  const module = await Test.createTestingModule({
    imports: [
      ConfigModule.forRoot({
        isGlobal: true,
        load: [
          () => ({
            app: { nodeEnv: 'test' },
            redis: { host: '127.0.0.1', port: 6379 },
            delivery: {
              internalServiceUrl: env.INTERNAL_SERVICE_URL ?? 'http://localhost:4001/internal',
              emailServiceUrl: env.EMAIL_SERVICE_URL ?? 'http://localhost:4002/email',
              channelTimeoutMs: 1000,
              maxAttempts: Number(env.DELIVERY_MAX_ATTEMPTS ?? 3),
              backoffBaseMs: Number(env.DELIVERY_BACKOFF_BASE_MS ?? 10),
            },
          }),
        ],
      }),
      BullModule.forRoot({
        connection: { host: '127.0.0.1', port: 6379 },
      }),
      DeliveryModule,
      QueuesModule,
      DeadLetterModule,
    ],
    providers: [DeliveryProcessor, DeadLetterProcessor],
  })
    .overrideProvider(DeadLetterRepository)
    .useValue(createFakeRepo(state))
    .compile();
  return { module, state };
}
```

- [ ] **Step 3: Write the integration test**

```ts
// test/delivery-retry.integration-spec.ts
jest.mock('ioredis', () => require('ioredis-mock'));

import { HttpService } from '@nestjs/axios';
import { Queue } from 'bullmq';
import { buildTestApp, FakeRepoState } from './helpers/test-app';
import { QueuesService } from '../src/queues/queues.service';
import { WebhookChannel } from '../src/delivery/channels/webhook.channel';
import { of, throwError } from 'rxjs';
import { AxiosError } from 'axios';

const waitFor = async (
  predicate: () => boolean,
  timeoutMs = 5000,
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
  let moduleRef: any;
  let state: FakeRepoState;
  let queues: QueuesService;

  beforeEach(async () => {
    const built = await buildTestApp({
      DELIVERY_MAX_ATTEMPTS: '3',
      DELIVERY_BACKOFF_BASE_MS: '10',
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
    const webhook = moduleRef.get(WebhookChannel);
    const http = moduleRef.get(HttpService);
    jest.spyOn(http, 'post').mockReturnValue(
      throwError(() =>
        Object.assign(new AxiosError('boom'), { response: { status: 500 } as any }),
      ),
    );

    await queues.enqueueDelivery({
      id: 'm1',
      body: 'b',
      deliveries: [{ channel: 'webhook', target: 'http://t' }],
    });

    await waitFor(() => state.records.size > 0, 10000);
    const [rec] = state.records.values();
    expect(rec.status).toBe('pending');
    expect(rec.attemptsMade).toBeGreaterThanOrEqual(3);
  });

  it('4xx failure lands in DLQ after 1 attempt (no retries)', async () => {
    const http = moduleRef.get(HttpService);
    const postSpy = jest.spyOn(http, 'post').mockReturnValue(
      throwError(() =>
        Object.assign(new AxiosError('bad'), { response: { status: 400 } as any }),
      ),
    );

    await queues.enqueueDelivery({
      id: 'm2',
      body: 'b',
      deliveries: [{ channel: 'webhook', target: 'http://t' }],
    });

    await waitFor(() => state.records.size > 0, 10000);
    expect(postSpy).toHaveBeenCalledTimes(1);
  });
});
```

- [ ] **Step 4: Run integration test**

Run: `yarn test:e2e --testPathPattern=integration`
Expected: both tests pass.
If ioredis-mock's mock isn't applied early enough, move the `jest.mock` line to a setup file configured via `setupFiles` in `test/jest-e2e.json`.

- [ ] **Step 5: Commit**

Ready for user to commit: `test: integration test for retry + DLQ flow`.

---

## Task 19: README rewrite + CLAUDE.md

**Files:**
- Replace: `README.md`
- Create: `CLAUDE.md`

- [ ] **Step 1: Rewrite README**

Replace `README.md` with:

```markdown
# Queues

NestJS service that delivers messages to webhook / internal-service / email channels with automatic retry and a dead-letter mechanism. Split into two processes: an API that accepts deliveries and an admin UI, and a Worker that drains queues and persists terminal failures.

## What it does

- `POST /deliveries` enqueues a message to the `delivery` BullMQ queue.
- The worker picks up each job and dispatches it to the listed channels over HTTP.
- On failure, BullMQ retries with exponential backoff (default 5 attempts, 1s base).
- On terminal failure (all retries exhausted, or a `4xx` response → "permanent"), the job is published to `dead_letter` and persisted to Postgres.
- Admins can list DLQ records, inspect queues, and resubmit failed jobs.

## Stack

- NestJS 11
- BullMQ 5 + Redis
- TypeORM + Postgres
- Axios (`@nestjs/axios`) for channel HTTP
- Winston logs (`nest-winston`)
- Swagger docs at `/api/docs`

## Quick start (Docker)

```
cp .env.example .env
docker compose up --build
```

Starts four services: `api` (http://localhost:3000), `worker`, Postgres, Redis. The worker picks up jobs automatically.

## Quick start (local)

```
yarn install
cp .env.example .env
# start Postgres and Redis however you like
yarn start:dev         # terminal 1: API
yarn start:worker:dev  # terminal 2: Worker
```

## Configuration

All via environment variables (see `.env.example`):

| Var | Meaning | Default |
|---|---|---|
| `PORT` | API HTTP port | 3000 |
| `DB_*` | Postgres connection | localhost/postgres |
| `REDIS_*` | Redis connection | localhost:6379 |
| `INTERNAL_SERVICE_URL` | URL for the internal-service channel | http://localhost:4001/internal |
| `EMAIL_SERVICE_URL` | URL for the email channel | http://localhost:4002/email |
| `CHANNEL_TIMEOUT_MS` | Axios timeout for channel calls | 10000 |
| `DELIVERY_MAX_ATTEMPTS` | BullMQ retry attempts | 5 |
| `DELIVERY_BACKOFF_BASE_MS` | Exponential backoff base | 1000 |

## API

### Enqueue a delivery

```
POST /deliveries
{
  "id": "msg-1",
  "subject": "hello",
  "body": "hi there",
  "deliveries": [
    { "channel": "webhook", "target": "https://example.com/hook" },
    { "channel": "email",   "target": "alice@example.com" }
  ],
  "metadata": { "requestId": "abc" }
}
```

### Admin endpoints

All under a passthrough guard — wire real auth before production.

| Method | Path | Description |
|---|---|---|
| `GET` | `/admin/queues/:name` | Counts + recent jobs. `:name` ∈ `delivery`, `dead_letter`. |
| `GET` | `/admin/queues/:name/:jobId` | Full job state. |
| `GET` | `/admin/dead-letter` | Paginated DLQ records. Query: `status`, `limit`, `offset`. |
| `GET` | `/admin/dead-letter/:id` | One DLQ record. |
| `POST` | `/admin/dead-letter/:id/resubmit` | Resubmit to the delivery queue. |

Full OpenAPI at `/api/docs`.

## Testing

```
yarn test        # unit tests
yarn test:e2e    # integration test (uses ioredis-mock)
yarn test:cov    # coverage
```

## Channel model

Each channel is a class implementing `DeliveryChannelHandler`. They are collected via the `DELIVERY_CHANNELS` DI token in `src/delivery/delivery.module.ts`. To add a new channel:

1. Create `src/delivery/channels/<name>.channel.ts`.
2. Implement `canHandle(channel)` + `deliver(target, payload)`.
3. Add it to the `DELIVERY_CHANNELS` factory in `delivery.module.ts`.
4. Extend `DeliveryChannel` in `delivery.interface.ts`.

## Queue model

- **`delivery`** queue, job names `deliver` (new) and `retry` (manual resubmit from DLQ). Both go through the same processor.
- **`dead_letter`** queue, job name `dead_letter`. Its processor writes a `DeadLetterRecord` row.
- BullMQ's native retry handles the retry mechanism; a `PermanentDeliveryError` (extends `UnrecoverableError`) skips remaining retries.

## Notes

- `synchronize: true` is on in development — tables auto-create from entities. Do **not** use this in production; switch to real migrations.
- The worker process runs `processors only`; the API process runs `controllers only`. Both share modules but never both run in the same process.
- Log format: pretty in dev, single-line JSON in production.
```

- [ ] **Step 2: Create CLAUDE.md**

```markdown
# CLAUDE.md

Project-specific guidance for Claude. See `README.md` for human documentation.

## What this is

A NestJS delivery/retry/DLQ service split into two processes:

- **API** (`src/main.ts` → `ApiModule`) — accepts `POST /deliveries`, serves admin endpoints and Swagger at `/api/docs`. No processors.
- **Worker** (`src/main.worker.ts` → `WorkerModule`) — runs BullMQ processors (`DeliveryProcessor`, `DeadLetterProcessor`). No HTTP server.

Both share Redis (BullMQ) and Postgres (DLQ records).

## Commands

- `yarn start:dev` — API in watch mode
- `yarn start:worker:dev` — worker in watch mode
- `yarn test` — unit tests (`*.spec.ts`)
- `yarn test:e2e` — integration tests (`test/*.integration-spec.ts`)
- `yarn tsc --noEmit` — type-check without building

Locally, run API and worker in two terminals. `docker compose up` runs both.

## Queue model

- `delivery` queue — job names `deliver` (new) and `retry` (manual resubmit). One processor. Retries via BullMQ (`attempts + backoff: exponential`).
- `dead_letter` queue — job name `dead_letter`. Processor writes a row to `dead_letter_records`.
- `PermanentDeliveryError` (extends BullMQ's `UnrecoverableError`) — channels throw this on 4xx so BullMQ skips retries and the job goes straight to DLQ.

## Adding a channel

1. Add `src/delivery/channels/<name>.channel.ts` implementing `DeliveryChannelHandler`.
2. Add the class to `DELIVERY_CHANNELS` DI factory in `src/delivery/delivery.module.ts`.
3. Extend the `DeliveryChannel` union in `src/delivery/delivery.interface.ts`.
4. Add `src/delivery/channels/<name>.channel.spec.ts` with the 2xx / 4xx / 5xx / timeout matrix.

## Config

All env vars flow through `src/config/configuration.ts` (exposed via `ConfigService.get('delivery.*' | 'redis.*' | 'database.*')`). Validation in `src/config/config.validation.ts`. New values → add both places + `.env.example`.

## Do not

- Do **not** flip `synchronize: true` to production. Use proper migrations when shipping.
- Do **not** move processors into the API process or controllers into the worker. Keep the split.
- Do **not** add a standalone `retry` queue. `retry` is a job name on `delivery`; BullMQ handles retries natively.
```

- [ ] **Step 3: Commit**

Ready for user to commit: `docs: human README + CLAUDE.md`.

---

## Self-review (to run before handing off)

When all tasks are complete, scan once:

- Every spec section has a corresponding task: architecture ✓ (T15/16), queue model ✓ (T9/12), channels ✓ (T6/7), DLQ persistence ✓ (T4/10/11), admin endpoints ✓ (T14), logger ✓ (T3/15/16), config ✓ (T2), testing ✓ (T6–14 + T18), README/CLAUDE.md ✓ (T19).
- No placeholders: every code step contains full, copy-pasteable code.
- Type consistency: `DeliveryResult` has `{ success, channel, target, message? }` used the same way in tests (T6–8) and the service (T8). `DeadLetterPayload` has `originalJobId: string` — used uniformly in tests and the service. `QueuesService` methods (`enqueueDelivery`, `enqueueRetry`, `enqueueDeadLetter`, `getDeliveryQueue`, `getDeadLetterQueue`) match in producer + admin controllers.
