# Queues

NestJS service that delivers messages to webhook / internal-service / email channels with automatic retry and a dead-letter mechanism. Split into two processes: an **API** that accepts deliveries and exposes admin endpoints, and a **Worker** that drains queues and persists terminal failures.

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

```bash
cp .env.example .env
docker compose up --build
```

Starts four services: `api` (http://localhost:3000), `worker`, Postgres, Redis. The worker picks up jobs automatically.

## Quick start (local)

```bash
yarn install
cp .env.example .env
# start Postgres and Redis however you like
yarn start:dev         # terminal 1: API
yarn start:worker:dev  # terminal 2: Worker
```

## Configuration

All configuration comes from environment variables (see `.env.example`):

| Var | Meaning | Default |
|---|---|---|
| `PORT` | API HTTP port | `3000` |
| `DB_HOST` / `DB_PORT` / `DB_USER` / `DB_PASSWORD` / `DB_NAME` | Postgres connection | `db` / `5432` / `postgres` / `postgres` / `queues` |
| `REDIS_HOST` / `REDIS_PORT` | Redis connection | `redis` / `6379` |
| `INTERNAL_SERVICE_URL` | URL for the `internal-service` channel | `http://localhost:4001/internal` |
| `EMAIL_SERVICE_URL` | URL for the `email` channel | `http://localhost:4002/email` |
| `CHANNEL_TIMEOUT_MS` | Axios timeout for channel calls | `10000` |
| `DELIVERY_MAX_ATTEMPTS` | BullMQ retry attempts per delivery | `5` |
| `DELIVERY_BACKOFF_BASE_MS` | Exponential backoff base delay | `1000` |

## API

### Enqueue a delivery

```http
POST /deliveries
Content-Type: application/json

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

Returns `{ "jobId": "<bullmq-job-id>" }`.

### Admin endpoints

All under a passthrough guard — wire real auth before production.

| Method | Path | Description |
|---|---|---|
| `GET` | `/admin/queues/:name` | Counts (waiting/active/delayed/failed/completed) + recent jobs. `:name` ∈ `delivery`, `dead_letter`. |
| `GET` | `/admin/queues/:name/:jobId` | Full job state (data, attempts, failedReason). |
| `GET` | `/admin/dead-letter` | Paginated DLQ records. Query: `status`, `limit`, `offset`. |
| `GET` | `/admin/dead-letter/:id` | One DLQ record. |
| `POST` | `/admin/dead-letter/:id/resubmit` | Resubmit to the delivery queue as a `retry` job. |

Full OpenAPI at `/api/docs`.

## Channel model

Each channel is a class implementing `DeliveryChannelHandler`. They are collected via the `DELIVERY_CHANNELS` DI token in `src/delivery/delivery.module.ts`.

| Channel | URL source | What `target` means | POST body |
|---|---|---|---|
| `webhook` | — (uses `target` directly) | full URL per request | `{ id, subject, body, metadata }` |
| `internal-service` | `INTERNAL_SERVICE_URL` | service path/identifier | `{ target, id, subject, body, metadata }` |
| `email` | `EMAIL_SERVICE_URL` | recipient address | `{ to: target, id, subject, body, metadata }` |

Each channel:
- 10s axios timeout
- 2xx → success
- 4xx → throws `PermanentDeliveryError` (skips retries, goes straight to DLQ)
- 5xx / network error / timeout → throws regular `Error` (counts as a retry attempt)

### Adding a new channel

1. Create `src/delivery/channels/<name>.channel.ts`.
2. Implement `canHandle(channel)` + `deliver(target, payload)`.
3. Add it to the `DELIVERY_CHANNELS` factory in `delivery.module.ts`.
4. Extend the `DeliveryChannel` type union in `delivery.interface.ts`.
5. Register the new class in both `DeliveryModule.providers` and the `inject` array of the channels factory.

## Queue model

- **`delivery`** queue handles both fresh (`'deliver'`) and manually resubmitted (`'retry'`) jobs through the same processor. Retries are native BullMQ (`attempts + backoff: exponential`).
- **`dead_letter`** queue receives terminal failures. Its processor writes a `DeadLetterRecord` row to Postgres.
- `PermanentDeliveryError` extends BullMQ's `UnrecoverableError` — BullMQ skips remaining retries when it's thrown.

## Testing

```bash
yarn test        # unit tests
yarn test:e2e    # integration test (real Redis via @testcontainers/redis — requires Docker)
yarn test:cov    # unit tests with coverage
```

Unit tests cover: channels (webhook / email / internal-service), delivery service + factory, queues service, dead-letter service + processor + repository, delivery processor (retry/permanent/DLQ branches), admin controllers.

## Notes

- `synchronize: true` is enabled outside production — tables auto-create from entities. Do **not** use this in production; switch to real migrations.
- Worker processes run `processors only`; the API process runs `controllers only`. Both share modules but never run processors and the HTTP server in the same process.
- Log format: pretty in dev, single-line JSON in production.
