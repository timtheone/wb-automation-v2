# Web App Migration Plan

## Goal

Replace the Telegram bot client with a TanStack Start web application while keeping the current backend, domain services, PostgreSQL model, and fire-and-forget queue behavior.

The migration should be incremental, not a rewrite.

## Core Principles

- Keep `apps/backend`, `packages/core`, and `packages/db` as the system of record.
- Replace the Telegram UI layer with a new `apps/web` TanStack Start app.
- Introduce Better Auth for web authentication.
- Preserve the current async queue behavior built on `pg-boss`.
- Generalize tenant resolution so the backend works for both Telegram and web during migration.
- Avoid exposing WB tokens or tenant identifiers directly to the browser.

## Target Architecture

- `apps/web`
  - TanStack Start application
  - authenticated dashboard
  - shops management UI
  - operations UI
  - async job tracking and artifact download
- `apps/backend`
  - existing Hono API
  - auth/session-aware tenant resolution
  - generic async job APIs for web
  - temporary support for both Telegram and web clients during migration
- `packages/core`
  - existing business logic reused with minimal change
- `packages/db`
  - current tenant and operational tables
  - new auth-related tables
  - new durable async flow/job tracking records for the web dashboard

## Product Scope for V1

- Login/logout
- Dashboard with operational metadata
- Shop CRUD and token rotation
- Per-shop sync visibility
- Triggering all current flows from the web UI
- Fire-and-forget job launching with status tracking
- PDF artifact download
- Single admin user per tenant

## High-Level Route Map

- `/login`
- `/app`
- `/app/shops`
- `/app/shops/new`
- `/app/shops/$shopId`
- `/app/operations`
- `/app/jobs`
- `/app/jobs/$jobId`
- `/app/settings`

## Phase 0 - Freeze Scope and Contracts

### Objectives

- Lock the v1 scope before implementation starts.
- Pin the major framework dependencies.
- Define the API and data contract needed by the web UI.

### Work

- Confirm deployment shape:
  - `apps/web` as a separate app
  - `apps/backend` remains the main business API
- Freeze the v1 UI route map.
- Define the required backend additions before building the frontend.

### Deliverables

- dependency/version decisions
- final v1 route map
- web-facing backend contract checklist

## Phase 1 - Add Web Authentication

### Objectives

- Introduce Better Auth for web login and session management.
- Keep the tenant model simple for v1: one admin owns one tenant.

### Work

- Add Better Auth setup and runtime configuration.
- Add the required auth database tables.
- Add a web user to tenant mapping.
- Keep the current Telegram tenant owner model intact during migration.
- Add auth/session endpoints:
  - session lookup
  - login
  - logout
  - current user endpoint
- Secure cookies and basic login protections.

### Deliverables

- Better Auth integrated
- authenticated session flow working
- user-to-tenant mapping for web

## Phase 2 - Generalize Tenant Resolution

### Objectives

- Remove Telegram-only assumptions from backend request handling.
- Allow both bot and web to resolve tenant context safely.

### Work

- Introduce a transport-agnostic request actor or tenant context abstraction.
- Keep Telegram context support for the existing bot.
- Add session-based tenant resolution for web requests.
- Ensure `tenantId` is always derived server-side.
- Keep current PostgreSQL tenant scoping and RLS behavior.

### Deliverables

- backend supports both Telegram and web callers
- tenant resolution no longer depends only on Telegram headers
- RLS path remains unchanged and safe

## Phase 3 - Normalize Async Job Tracking

### Objectives

- Preserve fire-and-forget execution.
- Make async jobs visible and queryable from the web UI.

### Work

- Keep `pg-boss` orchestration for queue execution.
- Extend durable job tracking in the database.
- Store job metadata useful for UI:
  - job type
  - status
  - actor
  - timestamps
  - summary
  - error
  - artifacts
- Add generic job endpoints:
  - list jobs
  - get job by id
  - retrieve artifacts
- Add missing status endpoints for:
  - sync content jobs
  - waiting orders PDF jobs
- Strongly consider making `process_all_shops` async as well.

### Deliverables

- durable async job model
- unified job tracking endpoints
- browser-friendly async flow lifecycle

## Phase 4 - Add Web-Ready Backend APIs

### Objectives

- Expose the metadata needed for a good dashboard and editing experience.
- Stop shaping responses only for Telegram flows.

### Work

- Add `GET /shops/:id`.
- Add per-shop sync status endpoints.
- Add dashboard summary endpoints.
- Add recent job/activity endpoints if needed beyond the generic jobs list.
- Change shop responses so raw tokens are not broadly returned to the browser.
- Keep token rotation on dedicated endpoints/actions.
- Consider artifact download endpoints instead of JSON base64 blobs.

### Deliverables

- dashboard-ready APIs
- shop detail APIs
- token-safe response shape for web

## Phase 5 - Scaffold `apps/web`

### Objectives

- Create the TanStack Start application shell and data layer.
- Establish routing, auth guards, and typed API access.

### Work

- Create `apps/web`.
- Set up TanStack Start routing and SSR.
- Add protected layout and login flow.
- Add a typed API client generated from backend OpenAPI.
- Add TanStack Query for fetching, mutations, and polling.
- Establish common UI layout:
  - app shell
  - top nav
  - sidebar
  - loading/error boundaries

### Deliverables

- web app bootstrapped
- authenticated app shell working
- typed API integration working

## Phase 6 - Build Shops UI

### Objectives

- Replace the Telegram `/shops` flow with a full web CRUD experience.

### Work

- Build shops list page.
- Build create shop form.
- Build shop detail/edit page.
- Build deactivate action.
- Build production/sandbox token rotation dialogs.
- Show useful metadata in the shop UI:
  - active/inactive state
  - sandbox mode
  - token updated at
  - last sync status
  - last sync time
  - last sync error

### Deliverables

- complete web replacement for shop CRUD
- better visibility than the Telegram bot flow

## Phase 7 - Build Operations UI

### Objectives

- Replace command-based Telegram operations with explicit web actions.

### Work

- Build operations dashboard/cards for:
  - process all shops
  - sync content
  - generate combined PDFs
  - generate waiting orders PDFs
- Preserve queue-first semantics:
  - user clicks action
  - backend returns `queued` or `running`
  - UI redirects to job tracking
- Add run summaries and result views.
- Add download actions for generated PDF artifacts.

### Deliverables

- all current bot-triggered flows available from web
- fire-and-forget behavior preserved

## Phase 8 - Build Dashboard and Job Monitoring

### Objectives

- Make operational state visible at all times.
- Surface the metadata you specifically want to see in the web app.

### Work

- Build `/app` dashboard with:
  - shop counts
  - active/inactive indicators
  - running jobs
  - recent failures
  - last sync summary
  - token health warnings
- Build `/app/jobs` list page.
- Build `/app/jobs/$jobId` detail page.
- Implement TanStack Query polling for v1.
- Stop polling automatically on terminal states.
- Optionally add SSE later if near-real-time updates become important.

### Deliverables

- dashboard with always-visible operational metadata
- reusable async job tracking experience

## Phase 9 - Security and Hardening

### Objectives

- Ensure the new browser client is safe and production-ready.

### Work

- Review CORS and cookie policy.
- Review CSRF protections if applicable.
- Ensure tokens are never exposed by default.
- Add auth and tenant boundary tests.
- Add job authorization tests.
- Validate that users cannot query another tenant's jobs or shops.
- Add rate limiting and abuse protections where needed.

### Deliverables

- hardened auth and API boundary
- validated tenant isolation for web

## Phase 10 - Testing Strategy

### Backend

- Add tests for session-based tenant resolution.
- Add tests for masked token responses.
- Add tests for job listing and job detail endpoints.
- Add tests for artifact download authorization.
- Add tests for async flow lifecycle and duplicate-job protection.

### Web

- Add route protection tests.
- Add form validation tests.
- Add shop CRUD tests.
- Add operations/job polling tests.
- Add artifact download tests.

### End-to-End

- Login
- create/edit/deactivate shop
- trigger sync job
- trigger PDF job
- track job completion
- download result artifacts

### Deliverables

- backend test coverage for new web behavior
- frontend integration confidence
- e2e smoke coverage for critical operator flows

## Phase 11 - Dual Run and Cutover

### Objectives

- Migrate safely without losing operational capability.

### Work

- Run Telegram bot and web app against the same backend during transition.
- Migrate operators to web login gradually.
- Keep Telegram as fallback until confidence is high.
- Perform production smoke checks for:
  - auth
  - shops
  - sync
  - PDFs
  - job tracking
- Decide whether to retire the bot or keep it as fallback/internal tooling.

### Deliverables

- stable web cutover
- optional Telegram fallback retained or retired intentionally

## Recommended Backend Endpoints to Add

### Auth

- `GET /auth/session`
- `GET /me`
- login/logout endpoints managed by Better Auth

### Shops

- `GET /shops/:id`
- `GET /shops/:id/sync-state`

### Dashboard

- `GET /dashboard/summary`

### Jobs

- `GET /jobs`
- `GET /jobs/:jobId`
- `GET /jobs/:jobId/artifacts/:artifactId`

### Flows

- `POST /flows/process-all-shops/async`
- `GET /flows/sync-content-shops/:jobId`
- `GET /flows/get-waiting-orders-pdf/:jobId`

## Polling Strategy for V1

- Use TanStack Query polling.
- Poll every 2 seconds while job is `queued` or actively `running`.
- Back off to 5 seconds for longer-running jobs if needed.
- Stop polling on `completed` or `failed`.
- Pause while the tab is hidden and refetch on focus.
- Prefer SSE later only if polling is not good enough.

## UI Priorities

The web app should not merely replicate Telegram. It should improve operator visibility and speed.

### Always-visible metadata

- current running jobs
- last sync result per shop
- last sync error per shop
- token freshness / expiration warnings
- active vs inactive shops
- sandbox vs production mode

### Editing improvements

- direct inline or form-based editing
- no conversational wizard for normal admin actions
- explicit validation and clearer error surfaces
- dedicated token rotation flows

## Main Risks

- TanStack Start is still RC, so version pinning matters.
- Better Auth introduces schema and runtime changes early.
- Browser clients require stronger token and tenant boundary handling than Telegram.
- Current pg-boss retention alone is not enough for a dashboard without durable history.
- Combined PDF artifact delivery should move away from large JSON base64 payloads.

## Recommended Implementation Order

1. Phase 0: freeze scope and versions.
2. Phase 1: add Better Auth.
3. Phase 2: generalize backend tenant resolution.
4. Phase 3: normalize async job persistence and APIs.
5. Phase 4: add dashboard/shop/status endpoints.
6. Phase 5: scaffold `apps/web`.
7. Phase 6: build shops UI.
8. Phase 7: build operations UI.
9. Phase 8: build dashboard and jobs UX.
10. Phase 9 and 10: hardening and tests.
11. Phase 11: dual run and cutover.

## Recommended V1 Authentication Choice

Use email and password for Better Auth in v1.

Why:

- simplest implementation path
- no OAuth provider setup required
- no dependency on third-party identity providers for first release
- easiest way to get the web app live quickly

OAuth can be added later if needed.
