# Queues

NestJS service that delivers messages to webhook / internal-service / email channels with automatic retry and a dead-letter mechanism. Split into two processes: an **API** that accepts deliveries and exposes admin endpoints, and a **Worker** that drains queues and persists terminal failures.

## What it does

- `POST /deliveries` enqueues a single delivery to the `delivery` BullMQ queue. To deliver the same message to multiple channels, POST once per channel.
- The worker picks up each job and dispatches it to the channel over HTTP.
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
| `INTERNAL_SERVICE_URL` | URL for the `internal-service` channel | `http://localhost:3000/mock/internal-service` |
| `EMAIL_SERVICE_URL` | URL for the `email` channel | `http://localhost:3000/mock/email` |
| `CHANNEL_TIMEOUT_MS` | Axios timeout for channel calls | `10000` |
| `DELIVERY_MAX_ATTEMPTS` | BullMQ retry attempts per delivery | `5` |
| `DELIVERY_BACKOFF_BASE_MS` | Exponential backoff base delay | `1000` |

The default URLs point at the built-in mock controller (see [Local mocks](#local-mocks)) so the full pipeline works out of the box without any external services.

## API

### Enqueue a delivery

```http
POST /deliveries
Content-Type: application/json

{
  "id": "msg-1",
  "channel": "webhook",
  "target": "https://example.com/hook",
  "subject": "hello",
  "body": "hi there",
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

## Local mocks

The API process exposes mock channel endpoints under `/mock/*` so the full delivery pipeline can be exercised end-to-end without any external services. They accept any JSON body, log it, and return `200 { ok: true }` by default.

The mock controller is wired into `ApiModule` only when `NODE_ENV !== 'production'`.

| Path | Used by | How to wire |
|---|---|---|
| `POST /mock/webhook` | `webhook` channel | set as `target` in the request body |
| `POST /mock/email` | `email` channel | `EMAIL_SERVICE_URL` env var |
| `POST /mock/internal-service` | `internal-service` channel | `INTERNAL_SERVICE_URL` env var |

### Producing failures

Append `?fail=<status>` to any mock URL to make it return that HTTP status. This is the way to drive the retry / DLQ paths during local testing:

- `?fail=400` (or any 4xx) → channel throws `PermanentDeliveryError` → BullMQ skips remaining retries → straight to DLQ.
- `?fail=500` (or any 5xx) → channel throws plain `Error` → BullMQ retries with exponential backoff up to `DELIVERY_MAX_ATTEMPTS`, then DLQ.

Example — happy path:

```bash
curl -X POST http://localhost:3000/deliveries \
  -H 'Content-Type: application/json' \
  -d '{
    "id": "demo-ok",
    "channel": "webhook",
    "target": "http://localhost:3000/mock/webhook",
    "body": "hi"
  }'
```

Permanent failure (skips retries, goes straight to DLQ):

```bash
curl -X POST http://localhost:3000/deliveries \
  -H 'Content-Type: application/json' \
  -d '{
    "id": "demo-permanent",
    "channel": "webhook",
    "target": "http://localhost:3000/mock/webhook?fail=400",
    "body": "hi"
  }'
```

Retryable failure (5 attempts with exponential backoff, then DLQ):

```bash
curl -X POST http://localhost:3000/deliveries \
  -H 'Content-Type: application/json' \
  -d '{
    "id": "demo-retry",
    "channel": "webhook",
    "target": "http://localhost:3000/mock/webhook?fail=500",
    "body": "hi"
  }'
```

For `email` / `internal-service`, set the `?fail=...` query directly in the env var, e.g. `EMAIL_SERVICE_URL=http://localhost:3000/mock/email?fail=500`.

After a delivery dead-letters, inspect and resubmit it:

```bash
curl http://localhost:3000/admin/dead-letter
curl -X POST http://localhost:3000/admin/dead-letter/<id>/resubmit
```

## Channel model

Each channel extends `HttpChannelBase` (`src/delivery/channels/http-channel.base.ts`) which implements `DeliveryChannelHandler`. The base owns axios, timeout, logging, and 4xx/5xx classification; subclasses only declare the channel name, the endpoint URL, and the POST body shape. Channels are collected via the `DELIVERY_CHANNELS` DI token in `src/delivery/delivery.module.ts`.

| Channel | URL source | What `target` means | POST body |
|---|---|---|---|
| `webhook` | — (uses `target` directly) | full URL per request | `{ id, subject, body, metadata }` |
| `internal-service` | `INTERNAL_SERVICE_URL` | service path/identifier | `{ target, id, subject, body, metadata }` |
| `email` | `EMAIL_SERVICE_URL` | recipient address | `{ to: target, id, subject, body, metadata }` |

Outcome handling (uniform across channels):
- axios timeout = `CHANNEL_TIMEOUT_MS` (default 10s)
- 2xx → success
- 4xx → throws `PermanentDeliveryError` (skips retries, goes straight to DLQ)
- 5xx / network error / timeout → throws regular `Error` (counts as a retry attempt)

### Adding a new channel

1. Create `src/delivery/channels/<name>.channel.ts` extending `HttpChannelBase`:
   - declare `channel` — the `DeliveryChannel` union string
   - implement `endpoint(payload)` — return the URL (from `ConfigService` or from `payload.target`)
   - implement `buildBody(payload)` — the POST body shape
   - (optional) override `permanentErrorMessage(status, payload)` — custom message for the 4xx case
   - **declare an explicit constructor** that calls `super(http, config)`. Nest DI requires the subclass to have its own constructor so that `design:paramtypes` metadata is emitted; without it the subclass is instantiated with `undefined` dependencies. See the existing channels for the pattern.
2. Extend the `DeliveryChannel` type union in `src/delivery/delivery.interface.ts`.
3. Register the new class in both `DeliveryModule.providers` and the `inject` array of the `DELIVERY_CHANNELS` factory.
4. Add `<name>.channel.spec.ts` with a 2xx / 4xx / 5xx / timeout matrix (see `webhook.channel.spec.ts` for the pattern).

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
