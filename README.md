# wb-automation-v2

`wb-automation-v2` is a clean rebuild of the old `wb-processor` system.

This project automates Wildberries FBS operational flows through a Telegram bot and a backend API. The bot stays thin, while the backend owns business orchestration, queue workers, and scheduled jobs.

## Documentation model

- `README.md` (this file): project-level documentation
  - goals
  - architecture
  - developer workflow
- `plan.md`: implementation roadmap used during delivery phases
  - phase tracking
  - scope decisions
  - incremental execution order

## Business context

The system supports daily FBS operations for Wildberries shops:

1. Process open orders into supplies and send supplies to delivery.
2. Sync product content to local storage for fast PDF generation.
3. Generate combined pick-list and sticker PDFs across shops.
4. Generate waiting-orders PDFs for recent supplies.
5. Warn operators when WB production tokens are close to expiration.

## Core product requirements

- Telegram bot is the operator interface.
- Backend is the single source of business logic.
- Bot only calls backend endpoints and sends user-facing responses.
- Shop CRUD is first-class, including token rotation (`wbToken`) and sandbox config.
- Multi-tenant isolation is based on Telegram context (private chat user or group owner).
- Single PostgreSQL database with tenant-scoped data and RLS protection.
- Strong typing for WB API via generated OpenAPI types.
- Unit tests validate flow orchestration with mocked WB API responses.

## Architecture

### System boundaries

- `apps/bot`
  - grammy command handling
  - i18n for operator messages (`ru`/`en`)
  - no business orchestration
- `apps/backend`
  - HTTP API for bot and future clients
  - flow orchestration and pg-boss workers
  - scheduled one-off jobs (sync, token-expiration checks, logs cleanup)
- `packages/core`
  - domain service logic, isolated and unit-testable
- `packages/db`
  - Drizzle schema, migrations, repositories, tenant context helpers
- `packages/wb-clients`
  - generated WB OpenAPI types and typed API wrappers
  - base `openapi-fetch` clients with auth middleware

### Monorepo layout

```text
wb-automation-v2/
  apps/
    backend/
    bot/
  packages/
    core/
    db/
    wb-clients/
  scripts/
  plan.md
```

## Technology choices

- Runtime: `node` (Node.js 22+, Docker image uses Node.js 24)
- Package manager: `pnpm` workspaces
- Language: TypeScript (strict mode)
- Bot: `grammy` + `typesafe-i18n`
- HTTP framework: `hono`
- Queue: `pg-boss`
- ORM/migrations: `drizzle-orm` + `drizzle-kit`
- Database: PostgreSQL 17 (Docker Compose)
- Runtime DB driver: node-postgres (`drizzle-orm/node-postgres`)
- Linting: `oxlint`
- Unit testing: `vitest`
- API type generation: `openapi-typescript`
- Typed runtime HTTP client: `openapi-fetch`

## Bot command surface

- `/process_all_shops`
- `/sync_content_shops`
- `/generate_pdfs`
- `/generate_waiting_orders_pdf`
- `/shops` for CRUD and token management
- `/cancel` to stop active `/shops` input flow
- Utility commands: `/start`, `/help`, `/ping`

## Flow execution model

- `/process_all_shops` is synchronous from bot perspective.
- `/sync_content_shops` uses async queue execution (`/flows/sync-content-shops/async`) and sends completion/failure notification to Telegram.
- `/generate_pdfs` and `/generate_waiting_orders_pdf` are fire-and-forget queue jobs.
- Bot replies immediately with queued/running status for async flows.
- PDF artifacts and async flow summaries are delivered by backend Telegram delivery service.
- Sync behavior is full traversal each run (cursor reset at start), with per-page pacing for WB API safety.
- Backend logs per-page sync metadata (shop, page, cursor in/out, status, counts) without dumping full payloads.

## Data model direction (high-level)

Current core entities:

- `tenants`
  - tenant owner (`ownerTelegramUserId`) and timestamps
- `tenantChats`
  - chat-to-tenant mapping for private/group/supergroup/channel
- `shops`
  - tenant-scoped shop config (`wbToken`, `wbSandboxToken`, `useSandbox`, `supplyPrefix`, active flag)
- `productCards`
  - tenant/shop card metadata for PDF enrichment
- `syncState`
  - per-shop sync state and diagnostics
- `jobRuns`
  - optional job history/diagnostics

## Current status

Repository is in active implementation, with all core operator flows available end-to-end:

- Tenant-aware model and request scoping are implemented (`tenants`, `tenant_chats`, tenant IDs on operational tables).
- PostgreSQL RLS policies are active for tenant-protected tables.
- Backend flow endpoints are implemented for processing, sync, and both PDF flows.
- Async flow execution is implemented with pg-boss workers:
  - combined PDF generation
  - waiting-orders PDF generation
  - async content sync
- Bot commands call backend flow endpoints directly and support queued/already-running responses.
- Daily scheduler jobs are available for:
  - sync-content job
  - WB token-expiration warning job
  - logs cleanup job
- WB token-expiration checking service and notification job are implemented (JWT `exp` based, warning threshold 4 days).
- Workspace quality gates are expected to stay green (`pnpm lint`, `pnpm typecheck`, `pnpm test`).

For detailed phase tracking, see `plan.md`.

## Development

### Prerequisites

- Node.js 22+
- `pnpm` available via Corepack or local install

### Setup

```bash
cp .env.example .env
cp .env.local.example .env.local
pnpm install
```

- `.env` is used for `prod:*` scripts.
- `.env.local` is used for `dev:*` and local DB scripts.

## VPS deployment (Docker Compose)

1. Fill `.env` with real secrets and Docker DB credentials:
   - `BOT_TOKEN=<your-telegram-token>`
   - `POSTGRES_USER=<db-user>`
   - `POSTGRES_PASSWORD=<db-password>`
   - optional `POSTGRES_DB=<db-name>`

Docker Compose builds container-internal `DATABASE_URL` and bot `BACKEND_BASE_URL` automatically.

2. Start stack:

```bash
docker compose up -d --build
```

3. Run migrations when needed (initial setup and after schema changes):

```bash
docker compose run --rm backend pnpm --filter @wb-automation-v2/db drizzle:migrate
```

4. Common operations:

```bash
docker compose stop
docker compose start
docker compose restart backend
docker compose logs -f backend bot scheduler-sync-content scheduler-wb-token-expiration scheduler-logs-cleanup
docker compose --profile grafana-logs up -d grafana-alloy
docker compose --profile manual run --rm job-sync-content
docker compose --profile manual run --rm job-wb-token-expiration
docker compose --profile manual run --rm job-logs-cleanup
```

Scheduler defaults are CET/CEST-compatible (`SCHEDULER_TZ=Europe/Berlin`).
To switch scheduler runtime to Moscow time, set `SCHEDULER_TZ=Europe/Moscow` in `.env`.
Logs cleanup runs daily and removes files in `logs/` older than `LOG_RETENTION_DAYS` (default `30`).

### Grafana Cloud logs (Alloy + OTLP)

This repo includes optional Grafana Alloy shipping to Grafana Cloud OTLP gateway.

1. In Grafana Cloud portal:
   - Open **Logs onboarding**, choose **Other**.
   - Create or reuse API token with logs write scope.
   - Copy the generated OTLP values (`OTEL_EXPORTER_OTLP_ENDPOINT` and `OTEL_EXPORTER_OTLP_HEADERS`).
2. Fill `.env` on your VPS:
   - `OTEL_EXPORTER_OTLP_ENDPOINT=https://.../otlp`
   - `OTEL_EXPORTER_OTLP_AUTH_HEADER=Basic <base64 username:token>`
   - optional `GRAFANA_LOGS_ENVIRONMENT=production`

If Grafana shows headers as `Authorization=Basic%20...`, convert it before saving:

- remove `Authorization=`
- decode `%20` to a normal space
- final value must start with `Basic `

3. Start the shipping agent:

```bash
docker compose --env-file .env --profile grafana-logs up -d grafana-alloy
```

4. Verify in Grafana:
   - Go to **Explore**, select Loki data source, run `{project="wb-automation-v2"}`.
   - Narrow by service: `{project="wb-automation-v2", service="backend"}` or `service="bot"`.

Alloy config lives at `monitoring/alloy/config.alloy` and reads app logs from Docker volume `app_logs`.

### Useful commands

- `pnpm dev:backend` - run backend in watch mode
- `pnpm dev:bot` - run Telegram bot in watch mode
- `GET /openapi.json` - backend OpenAPI spec
- `GET /docs` - Swagger UI for backend API
- `pnpm scheduler:sync start` - install sync-content cron entry
- `pnpm scheduler:sync stop` - remove sync-content cron entry
- `pnpm scheduler:sync status` - show sync-content scheduler status
- `pnpm scheduler:sync run` - run sync-content job once now
- `pnpm scheduler:wb-token-expiration start` - install token-expiration cron entry
- `pnpm scheduler:wb-token-expiration stop` - remove token-expiration cron entry
- `pnpm scheduler:wb-token-expiration status` - show token-expiration scheduler status
- `pnpm scheduler:wb-token-expiration run` - run token-expiration check once now
- `pnpm prod:up` - build and start production compose stack using `.env`
- `pnpm prod:down` - stop and remove production compose stack
- `pnpm prod:migrate` - run DB migrations manually in Docker
- `pnpm prod:restart:backend` - restart backend container
- `pnpm prod:restart:bot` - restart bot container
- `pnpm prod:logs:shipper:up` - start Grafana Alloy shipping logs to Grafana Cloud
- `pnpm prod:logs:shipper:down` - stop Grafana Alloy log shipping sidecar
- `pnpm prod:logs` - follow backend, bot, and scheduler logs
- `pnpm prod:job:sync-content` - run sync-content job once in Docker
- `pnpm prod:job:wb-token-expiration` - run token-expiration job once in Docker
- `pnpm prod:job:logs-cleanup` - run logs cleanup job once in Docker
- `pnpm db:local:up` - start local PostgreSQL container using `.env.local`
- `pnpm db:local:down` - stop local database stack
- `pnpm db:local:reset` - reset local DB volume and apply local migrations
- `pnpm db:push` - push schema directly (fast local iteration)
- `pnpm db:generate` - generate new Drizzle SQL migration
- `pnpm db:migrate` - apply pending Drizzle migrations
- `pnpm db:studio` - open Drizzle Studio (default port `4990`)
- `pnpm wb:gen` - regenerate WB OpenAPI TypeScript files
- `pnpm build` - compile workspace TypeScript to `dist/` for production runtime
- `pnpm build:clean` - remove build output folders in apps/packages
- `pnpm lint` - run oxlint
- `pnpm lint:fix` - run oxlint auto-fix
- `pnpm typecheck` - run workspace TypeScript checks
- `pnpm test` - run unit tests
- `pnpm test:watch` - run tests in watch mode
- `pnpm test:coverage` - run unit tests with coverage report (`coverage/`)
- `pnpm format` - check formatting with Prettier
- `pnpm format:write` - apply formatting with Prettier

### Scheduler control

- Sync-content scheduler script: `scripts/sync-content-scheduler.sh`.
  - default schedule: `0 6 * * *` (daily 06:00 server local time)
  - scheduler logs: `logs/sync-content-scheduler.log`
- WB token-expiration scheduler script: `scripts/wb-token-expiration-scheduler.sh`.
  - default schedule: `0 9 * * *` (daily 09:00 server local time)
  - scheduler logs: `logs/wb-token-expiration-scheduler.log`
- Backend app logs use `BACKEND_LOG_FILE` (default `logs/backend.log`).
- Bot app logs use `BOT_LOG_FILE` (default `logs/bot.log`).
- Custom cron expression example:

```bash
bash ./scripts/sync-content-scheduler.sh start "30 2 * * *"
bash ./scripts/wb-token-expiration-scheduler.sh start "15 8 * * *"
```

## Environment variables

See `.env.example` and `.env.local.example`.

Current variables:

- `BACKEND_PORT` - backend listening port
- `BACKEND_BASE_URL` - bot target backend URL for local non-Docker runs (Docker Compose always uses `http://backend:3000`)
- `BACKEND_LOG_LEVEL` - pino log level (default `info`)
- `BACKEND_LOG_HEALTHCHECKS` - set `true` to log `/health` requests (default `false`)
- `BACKEND_LOG_FILE` - backend log file path (default `logs/backend.log`)
- `BOT_TOKEN` - Telegram bot token
- `BOT_LOG_LEVEL` - bot pino log level (default `info`)
- `BOT_LOG_FILE` - bot log file path (default `logs/bot.log`)
- `POSTGRES_DB` - local Docker Postgres database name
- `POSTGRES_USER` - local Docker Postgres username
- `POSTGRES_PASSWORD` - local Docker Postgres password
- `POSTGRES_PORT` - local Docker Postgres host port (default `5440`)
- `DRIZZLE_STUDIO_PORT` - Drizzle Studio local port (default `4990`)
- `DATABASE_URL` - Postgres connection string for local non-Docker runs (Docker Compose derives URL from `POSTGRES_*`)
- `PG_BOSS_SCHEMA` - optional pg-boss schema override (default `pgboss`)
- `SCHEDULER_TZ` - timezone used by Docker scheduler services (default `Europe/Berlin`, optional `Europe/Moscow`)
- `SYNC_CONTENT_CRON` - cron expression for sync-content scheduler in Docker Compose
- `WB_TOKEN_EXPIRATION_CRON` - cron expression for WB token-expiration scheduler in Docker Compose
- `LOG_CLEANUP_CRON` - cron expression for logs cleanup scheduler in Docker Compose (default `0 3 * * *`)
- `LOG_RETENTION_DAYS` - number of days to keep log files in `logs/` (default `30`)
- `OTEL_EXPORTER_OTLP_ENDPOINT` - Grafana Cloud OTLP endpoint (`https://.../otlp`)
- `OTEL_EXPORTER_OTLP_AUTH_HEADER` - Authorization header value in format `Basic <base64 username:token>`
- `GRAFANA_LOGS_ENVIRONMENT` - log label attached by Alloy targets (default `production`)

## Migration intent from legacy project

v2 intentionally removes:

- Prisma/Supabase split
- per-user sqlite databases
- mixed responsibility between bot and backend
- dead/unused command surface

and replaces it with a single, explicit architecture and testable domain flows.
