# Implementation notes

Setup details agreed alongside the [decisions](decisions.md). The repo scaffold follows them.

## Repo layout

- `src/apps/api`: Express, Drizzle, Better Auth, pg-boss
- `src/apps/web`: Nuxt with Nuxt UI and TanStack Query
- `src/packages/shared`: TypeScript types and validation schemas, shipped as source (no build step). Four entry points, imported by subpath with no root entry: `@checklog/shared/api` (request schemas and response types), `/domain` (the shared model: enums, field and notification schemas), `/auth` (access control) and `/utils`
- All app and package code lives under the root `src/` folder
- Root: shared ESLint config, `pnpm-workspace.yaml`, pnpm catalogs for shared dependency versions, `AGENTS.md`, `CLAUDE.md`, `CONTRIBUTING.md`, PR template with the AI-use checkbox

## pnpm and builds

- Apps depend on the shared package with `workspace:*`
- `pnpm -r run build` builds in dependency order; `pnpm --filter <app>` targets one app
- The API runs with tsx in dev and is bundled with tsdown for production, with `deps.alwaysBundle: [/^@checklog\/shared(\/|$)/]` so the shared source and all its subpaths are bundled in
- `pnpm deploy --filter api` produces the standalone folder for the API image
- Turborepo is not used for now; add it later if build times justify caching

## Linting

- One flat ESLint config at the root with Stylistic; Prettier is not used
- The web app wraps it with `withNuxt(sharedConfig)`; `@nuxt/eslint` stylistic, import rules and other optional tooling stay off
- Imports: `eslint-plugin-import-x` sorts them into groups (built-in, external, internal `@checklog/*`/`@`/`~`/`#`, relative) with a blank line between, and type-only imports use top-level `import type`. Resolution checks are left to TypeScript
- App source has no `../` imports: the API imports other folders as `@/` (its `src`, through `paths` in its `tsconfig.json`, which tsx, tsdown, Vitest and drizzle-kit all follow) and the web app uses Nuxt's `~/`. Files in the same folder use `./`. The shared package stays relative because the API type-checks its source with the API's own `paths`
- Every `eslint-disable` comment needs a `-- reason` and must be closed (`@eslint-community/eslint-plugin-eslint-comments`)
- Stylistic does not format `<template>` blocks, so `vue/*` layout rules live in the web app's ESLint config as a Nuxt-specific override
- The API's own imports name the `.ts` file (`import-x/extensions`, reported but not autofixed, since the fix writes `@/db.ts` for a folder). The shared VS Code settings make auto-imports write `@/db/index.ts`

## Tests

- Each package's tests live in a `test` folder beside `src`, mirroring its layout (`src/core/permissions.ts` is tested in `test/core/permissions.test.ts`). Helpers live in `test/support`
- API tests import source with `@/` and helpers with `@test/`. Shared package tests import its entry points (`@checklog/shared/domain`), so they test its public exports
- The API has two Vitest projects. `unit` runs `*.test.ts` and the `*.test-d.ts` type tests with nothing running. `db` runs `*.db.test.ts` against Postgres 18 in Docker, started once per run by Testcontainers and migrated with the API's own runner. `pnpm test` runs both, so it needs Docker running; `vitest run --project unit` skips the database
- Database tests run each test inside a transaction that's rolled back (`inRollback`), so they share one database without cleanup

## API and auth

- Nuxt has no server routes; every data call goes to the Express API
- Serve web and API under one domain behind a reverse proxy (for example `/api` to Express) so session cookies stay first-party and SSR requests work
- Mount the Better Auth handler before `express.json()`
- One router per area under `/api` (templates, runs, approvals, schedules, notifications, members), all created up front
- Route handlers use a typed `route()` helper that validates `params`, `query` and `body` with Zod schemas from `packages/shared` and passes the parsed values in; Express 5's `req.query` is read-only, so plain validation middleware can't hand handlers typed input
- Responses are plain TypeScript types with a `Dto` suffix (`TemplateDto`) in `@checklog/shared/api`, one file per area with request schemas first. Drizzle row types keep plain names (`Template`) in the API's `util/types.ts`
- Mappers in `src/mappers/`, one file per area, turn rows into response types: `to<Thing>Dto(row: <Thing>): <Thing>Dto`. They list every field explicitly, never `...row`, so a new column or `organizationId` can't leak into a response, and send dates as ISO strings
- Successful responses are 200, creates included; the body is the created or changed resource
- Every API error except Better Auth's (`/api/auth/*` keeps its own format) uses one shape: `{ "error": { "code": "not_found", "message": "Run not found", "details": [] } }`, with `details` holding the Zod issues on validation errors only. Unexpected errors are logged and return a generic `internal` 500
- Refused requests are checked in this order: `404 not_found` when the member can't see the resource at all (other organizations' and missing IDs included, so hidden and missing look the same), `403 forbidden` when they can see it but lack the access for the action, and `400` (`validation_failed`, `precondition_failed`) or `409 conflict` when they can act but the request is invalid or the resource is in the wrong state
- Writes put the access they need in the `where` (`visibleTemplatesWhere`), so the usual case is one query; only when nothing matches does the route look up the member's level (`templateAccessLevel`) to pick the error
- Use Better Auth's organization plugin for tenants, members, roles and invitations
- Write sign-ins, role changes and invitations to the audit log via Better Auth hooks
- SAML is community-maintained in Better Auth; OIDC covers most identity providers
- The development seed (`pnpm db:seed`) creates users and organizations through `auth.api` rather than inserting rows, so passwords are hashed and IDs are TypeIDs; it skips anything that already exists and refuses to run with `NODE_ENV=production`

## Frontend data

- TanStack Query handles all API calls (not `useFetch`)
- A Nuxt plugin dehydrates server-fetched queries and hydrates them in the browser so SSR pages do not fetch twice
- `useApi()` calls the API: during SSR it goes straight to `NUXT_API_INTERNAL_URL` with the visitor's cookie, in the browser through `/api`. Errors throw an `ApiError` parsed with the shared error schema
- Better Auth's client is used for auth calls only; the session and organization list live in TanStack Query (`useSessionQuery`, `useOrganizationsQuery`), and switching organization refetches every query
- Pages are signed-in only; `definePageMeta({ auth: "public" })` opts out, matching the API's `route()` option. The guard never redirects `/login` itself, so a missing sign-in page can't loop
- `definePageMeta({ auth: "platform-admin" })` limits a page to platform admins (`isPlatformAdmin`, which reads the comma-separated `user.role`). Anyone else gets a 404 rather than a redirect, so the pages don't reveal that they exist. They live under `/platform-admin`, linked from the user menu for platform admins only
- Icons come from the locally installed `@iconify-json/lucide`, never Iconify's public API, and Nuxt Icon's endpoint sits at `/_nuxt_icon` because `/api` belongs to Express

## Kubernetes and Docker

- Dockerfiles live in `docker/` (`api.Dockerfile`, `web.Dockerfile`) and build from the repo root. Both use `node:24-trixie-slim`, install with the pinned pnpm through Corepack, and copy only build output into the runtime stage, owned by root and run as the `node` user. The API image is built with `pnpm deploy --prod` and also carries `drizzle/` for the migrate Job.
- `docker-compose.yaml` runs Postgres for local development only (`pnpm db:up`); it is not the production deployment.
- CI (`.github/workflows/ci.yml`) runs lint, typecheck, test and build, and builds both images for `linux/amd64` and `linux/arm64` on native runners. Pull requests only build. Pushes to `main` publish `ghcr.io/<owner>/checklog-api` and `checklog-web` to GHCR as multi-platform images tagged `main` and `sha-<commit>`, once every check has passed. Release tags aren't published yet.
- Two images, `api` and `web`, multi-stage, running as a non-root user; pg-boss workers run from the api image as their own deployment, scaled separately from the API
- Liveness and readiness endpoints; graceful shutdown on SIGTERM for requests and jobs
- All configuration through environment variables
- Each app keeps its own `.env.example` next to its `package.json`. In development:
  - The API's `dev` and `dev:worker` scripts preload the `dotenv` package with `tsx watch --import dotenv/config`, and `drizzle.config.ts` imports `dotenv/config`. Both read `src/apps/api/.env`; a missing file is not an error.
  - Nuxt loads `src/apps/web/.env` itself in `nuxt dev`, so the web app needs no extra setup.
  - Production scripts (`start`, `start:worker`, the Nuxt server) never load a file: Kubernetes supplies the variables. Application code never imports `dotenv`.
- Production migrations run as a Job or init container using the API image with the command `node dist/migrate.mjs`
- Dev and staging can set `MIGRATE_ON_START=true` (default off) to run the same migration function at startup, wrapped in a Postgres advisory lock so multiple replicas do not race
- When proof upload arrives in v1, files go to S3-compatible storage, never pod disk

## Cross-platform

- `pnpm-workspace.yaml` sets `shellEmulator: true` so package scripts run the same on Windows and Unix (pnpm 11+ reads project settings from there, not `.npmrc`)
- Anything beyond one-line scripts is written as a small Node script
- `.gitattributes` sets `* text=auto eol=lf`

## Dependency updates

- Renovate is configured in `renovate.json`; see the dependency dashboard issue it opens
- pnpm catalogs keep shared versions in one place, so a grouped Node update usually touches only `pnpm-workspace.yaml` and the lockfile
