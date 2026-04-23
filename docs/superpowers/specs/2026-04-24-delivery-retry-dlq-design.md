# Delivery Retry & Dead-Letter — Design

**Status:** approved
**Date:** 2026-04-24

## Goal

Ship a NestJS service that delivers messages to one of three channels (webhook, internal-service, email) with automatic retry + exponential backoff, moves terminally-failed jobs to a dead-letter store, and exposes admin endpoints to inspect queues and resubmit dead-lettered messages.

## Non-goals

- Production-grade auth (passthrough guard only; TODO for real auth)
- TypeORM migrations (use `synchronize: true` outside production)
- Horizontal scaling concerns beyond "worker is a separate process"
- Observability beyond structured winston logs

## Architecture

Single codebase, two entrypoints sharing modules. API publishes jobs; worker consumes them. No processors run in the API process; no HTTP server in the worker process.

```
src/
├── main.ts               # API boot — ApiModule (controllers only)
├── main.worker.ts        # Worker boot — WorkerModule (processors only)
├── app/
│   ├── api.module.ts     # HTTP: delivery controller + admin + swagger
│   └── worker.module.ts  # BullMQ processors: delivery + dead_letter
├── delivery/             # shared — channels, factory, service, DTO
│   └── channels/         # webhook, internal-service, email (all real axios)
├── queues/               # shared — QueuesService (producer), constants
├── dead-letter/          # shared — service, processor, entity, repository
├── admin/                # API-side — queue + DLQ controllers, passthrough guard
├── logger/               # shared — nest-winston setup
└── config/               # shared — configuration.ts + validation
```

`docker-compose.yml` gets two services from the same image (`api`, `worker`) with different `command:`. Locally: `yarn start:dev` (api) and `yarn start:worker:dev` (worker) in two terminals.

## Queue model

Two BullMQ queues:

- **`delivery`** — fresh and resubmitted deliveries. Has BullMQ-native retry: `attempts: 5`, `backoff: { type: 'exponential', delay: 1000 }`.
- **`dead_letter`** — terminal failures, triggers Postgres persistence.

Three job names:

- `'deliver'` — new work from the API
- `'retry'` — manual resubmits from DLQ admin endpoint (same queue, same processor)
- `'dead_letter'` — DLQ queue only

### Happy path

1. `POST /deliveries` → `deliveryQueue.add('deliver', payload, { attempts, backoff })`
2. Worker's `DeliverProcessor` → `DeliveryService.deliver(payload)` → iterates `deliveries[]`, resolves handler via `DeliveryFactory`, calls `handler.deliver(target, basePayload)`
3. All channels return success → job completes

### Retry path

1. A channel throws → processor rethrows → BullMQ re-queues on `delivery` with exponential backoff (1s, 2s, 4s, 8s, 16s)
2. `attemptsMade` is incremented by BullMQ per attempt

### Dead-letter path

1. On the final attempt (`job.attemptsMade + 1 >= job.opts.attempts`), the `DeliverProcessor` builds a `DeadLetterPayload` and calls `deadLetterQueue.add('dead_letter', record)` **before** rethrowing
2. BullMQ marks the delivery job `failed` (kept for inspection)
3. `DeadLetterProcessor` picks up the DLQ job, writes a `DeadLetterRecord` row to Postgres (`status: 'pending'`), and logs `error` via winston

### Fail-fast path (permanent errors)

Any channel that throws `PermanentDeliveryError` (e.g. HTTP 4xx) short-circuits retries. `PermanentDeliveryError` extends BullMQ's `UnrecoverableError`, which tells BullMQ not to retry this job. The `DeliverProcessor` detects this error in its catch block (via `instanceof`), publishes to DLQ, and rethrows — job lands in `failed` state after 1 attempt.

### Resubmit path

1. `POST /admin/dead-letter/:id/resubmit`
2. Read `DeadLetterRecord` by id → `deliveryQueue.add('retry', record.payload, { attempts, backoff })`
3. Update record: `status='resubmitted'`, `resubmittedAt=now()`
4. Return `{ jobId, status: 'resubmitted' }`

## Channels

All three make real HTTP POSTs via `@nestjs/axios`. Internal-service and email URLs come from env; webhook's URL is the per-delivery `target`.

| Channel | URL source | Request body |
|---|---|---|
| `webhook` | `target` (full URL per request) | `{ id, subject, body, metadata }` |
| `internal-service` | `INTERNAL_SERVICE_URL` env | `{ target, id, subject, body, metadata }` |
| `email` | `EMAIL_SERVICE_URL` env | `{ to: target, subject, body, metadata }` |

All channels:

- 10s axios timeout (`CHANNEL_TIMEOUT_MS`)
- 2xx → `{ success: true }`
- 4xx → throws `PermanentDeliveryError` (extends BullMQ's `UnrecoverableError` — BullMQ skips remaining retries, processor publishes to DLQ in the same catch block before rethrowing)
- 5xx / network error / timeout → throws plain `Error` (retryable by BullMQ)
- `winston.info` on success, `winston.error` on failure — at the call site, with `{ channel, target, jobId?, status?, reason? }`

Channels are registered with `DeliveryFactory` via a DI-provided array token (`DELIVERY_CHANNELS`), keeping the add-a-new-channel extension point clean.

### Partial delivery failure

Deliveries within one job run sequentially. If the 2nd channel fails after the 1st succeeds, the whole job fails and BullMQ retries. On retry, the 1st channel is called again — this can cause duplicate deliveries to the first-succeeding channel. Acceptable for test scope; noted as a known limitation (production fix: per-delivery idempotency keys or per-channel sub-jobs).

## DLQ persistence

**Entity** (`dead_letter_records` table, TypeORM, `synchronize: true` when `NODE_ENV !== 'production'`):

```ts
@Entity('dead_letter_records')
class DeadLetterRecord {
  @PrimaryGeneratedColumn('uuid') id: string;
  @Column() originalJobId: string;
  @Column('jsonb') payload: DeliveryPayload;
  @Column('text', { array: true }) channels: string[];
  @Column('text') reason: string;
  @Column('int') attemptsMade: number;
  @Column('timestamptz') failedAt: Date;
  @Column('timestamptz', { nullable: true }) resubmittedAt: Date | null;
  @Column({ type: 'enum', enum: ['pending', 'resubmitted'], default: 'pending' })
  status: 'pending' | 'resubmitted';
  @CreateDateColumn() createdAt: Date;
}
```

**Repository methods:** `save(record)`, `findById(id)`, `findPaginated({ status?, limit, offset })`, `markResubmitted(id)`.

The `DeadLetterProcessor` owns DB writes. No other component writes to this table.

## Admin endpoints

All under `AdminGuard` (passthrough — `canActivate(): boolean { return true; }` with a TODO to add real auth). Documented via `@nestjs/swagger` at `/api/docs`.

```
GET    /admin/queues/:name
  :name in ('delivery', 'dead_letter')
  → { waiting, active, delayed, failed, completed, recentJobs: JobDto[] }

GET    /admin/queues/:name/:jobId
  → { id, name, data, attemptsMade, state, failedReason, timestamp, ... }

GET    /admin/dead-letter?status=&limit=&offset=
  → { items: DeadLetterRecord[], total: number }

GET    /admin/dead-letter/:id
  → DeadLetterRecord (404 if missing)

POST   /admin/dead-letter/:id/resubmit
  → { jobId: string, status: 'resubmitted' }
  (404 if missing, 409 if already resubmitted)
```

DTOs decorated with `@ApiProperty` for Swagger.

## Logging

`nest-winston` registered at the app root:

- Dev: pretty console format
- Prod: single-line JSON with `{ timestamp, level, message, context, ...meta }`
- Every channel call, DLQ write, and admin action logs with structured metadata (`jobId`, `channel`, `attemptsMade`, `reason` where applicable)

Processors + controllers inject `LoggerService` via `WINSTON_MODULE_NEST_PROVIDER`.

## Configuration

New env vars added to `.env.example`, `configuration.ts`, and `config.validation.ts`:

```
# Existing
NODE_ENV, PORT
DB_HOST, DB_PORT, DB_USER, DB_PASSWORD, DB_NAME
REDIS_HOST, REDIS_PORT

# New
INTERNAL_SERVICE_URL=http://localhost:4001/internal
EMAIL_SERVICE_URL=http://localhost:4002/email
CHANNEL_TIMEOUT_MS=10000
DELIVERY_MAX_ATTEMPTS=5
DELIVERY_BACKOFF_BASE_MS=1000
```

Validation tightened: required in prod, optional in test (so integration tests can run without env).

## Testing

Jest + `@nestjs/testing` + `ioredis-mock` for integration.

**Unit tests** (mock everything):

- `delivery.service.spec.ts` — dispatch + aggregation + error propagation
- `delivery.factory.spec.ts` — handler resolution + unknown channel
- `webhook-channel.spec.ts` — 2xx / 4xx (permanent) / 5xx / timeout cases
- `email-channel.spec.ts`, `internal-service.spec.ts` — same matrix
- `dead-letter.service.spec.ts` — payload building + queue publish
- `dead-letter.processor.spec.ts` — persistence to repository
- `admin/dead-letter.controller.spec.ts` — list + resubmit + 404
- `admin/queue.controller.spec.ts` — counts + recent jobs

**Integration test** (real BullMQ + `ioredis-mock`, in-memory DLQ repo):

- `delivery-retry.integration-spec.ts`
  - 3 failures → DLQ record created (uses reduced `DELIVERY_MAX_ATTEMPTS=3`, `DELIVERY_BACKOFF_BASE_MS=10` for speed)
  - resubmit endpoint re-enqueues, fails 3x again, new DLQ record
  - 4xx response → DLQ after 1 attempt (no retries wasted)

Shared `test/helpers/test-app.ts` builds the module with `ioredis-mock` and an in-memory repo.

## Docs & developer onboarding

- **README rewrite** — human-readable, reflects api+worker split, the queue model, channel env vars, test commands, and how to inspect DLQ + resubmit.
- **CLAUDE.md** — project purpose, run commands (api + worker), queue model summary, channel extension pattern (register with `DELIVERY_CHANNELS` token), test commands, note on `synchronize: true` being dev-only.

## Out of scope / explicit TODOs

- Real auth on admin endpoints (passthrough guard with TODO comment)
- TypeORM migrations (use `synchronize` in dev; prod would require migrations)
- Multi-region / high-availability worker deployment
- Per-channel custom retry policies (one policy applies to all deliveries in a job)
- DLQ retention policy / archival
