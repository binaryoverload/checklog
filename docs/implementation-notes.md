# Implementation notes

Setup details agreed alongside the [decisions](decisions.md). The repo scaffold follows them.

## Repo layout

- `src/apps/api`: Express, Drizzle, Better Auth, pg-boss
- `src/apps/web`: Nuxt with Nuxt UI and TanStack Query
- `src/packages/shared`: TypeScript types and validation schemas, shipped as source (no build step)
- All app and package code lives under the root `src/` folder
- Root: shared ESLint config, `pnpm-workspace.yaml`, pnpm catalogs for shared dependency versions, `AGENTS.md`, `CLAUDE.md`, `CONTRIBUTING.md`, PR template with the AI-use checkbox

## pnpm and builds

- Apps depend on the shared package with `workspace:*`
- `pnpm -r run build` builds in dependency order; `pnpm --filter <app>` targets one app
- The API runs with tsx in dev and is bundled with tsdown for production, with `deps.alwaysBundle: ['@checklog/shared']` so the shared source is bundled in
- `pnpm deploy --filter api` produces the standalone folder for the API image
- Turborepo is not used for now; add it later if build times justify caching

## Linting

- One flat ESLint config at the root with Stylistic; Prettier is not used
- The web app wraps it with `withNuxt(sharedConfig)`; `@nuxt/eslint` stylistic and other optional tooling stay off
- Stylistic does not format `<template>` blocks, so `vue/*` layout rules live in the web app's ESLint config as a Nuxt-specific override

## API and auth

- Nuxt has no server routes; every data call goes to the Express API
- Serve web and API under one domain behind a reverse proxy (for example `/api` to Express) so session cookies stay first-party and SSR requests work
- Mount the Better Auth handler before `express.json()`
- Use Better Auth's organization plugin for tenants, members, roles and invitations
- Write sign-ins, role changes and invitations to the hash-chained audit log via Better Auth hooks
- SAML is community-maintained in Better Auth; OIDC covers most identity providers

## Frontend data

- TanStack Query handles all API calls (not `useFetch`)
- A Nuxt plugin dehydrates server-fetched queries and hydrates them in the browser so SSR pages do not fetch twice

## Kubernetes and Docker

- Two images, `api` and `web`, multi-stage, running as a non-root user; pg-boss workers run from the api image as their own deployment, scaled separately from the API
- Liveness and readiness endpoints; graceful shutdown on SIGTERM for requests and jobs
- All configuration through environment variables
- Each app keeps its own `.env.example` next to its `package.json`. In development:
  - The API's `dev` and `dev:worker` scripts preload the `dotenv` package with `tsx watch --import dotenv/config`, and `drizzle.config.ts` imports `dotenv/config`. Both read `src/apps/api/.env`; a missing file is not an error.
  - Nuxt loads `src/apps/web/.env` itself in `nuxt dev`, so the web app needs no extra setup.
  - Production scripts (`start`, `start:worker`, the Nuxt server) never load a file: Kubernetes supplies the variables. Application code never imports `dotenv`.
- Production migrations run as a Job or init container using a migrate command in the API image
- Dev and staging can set `MIGRATE_ON_START=true` (default off) to run the same migration function at startup, wrapped in a Postgres advisory lock so multiple replicas do not race
- When proof upload arrives in v1, files go to S3-compatible storage, never pod disk

## Cross-platform

- `pnpm-workspace.yaml` sets `shellEmulator: true` so package scripts run the same on Windows and Unix (pnpm 11+ reads project settings from there, not `.npmrc`)
- Anything beyond one-line scripts is written as a small Node script
- `.gitattributes` sets `* text=auto eol=lf`

## Dependency updates

- Renovate is configured in `renovate.json`; see the dependency dashboard issue it opens
- pnpm catalogs keep shared versions in one place, so a grouped Node update usually touches only `pnpm-workspace.yaml` and the lockfile
