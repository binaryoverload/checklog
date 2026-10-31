# Decisions

Recorded 2026-10-31. Add new decisions to the end of the list with a date; when one is reversed, strike it through and link to what replaced it.

## Decided

| Area | Decision |
| --- | --- |
| Name | Checklog (GitHub org: `checklog-app`) |
| Licence | AGPLv3 with the Commons Clause, so others may not sell Checklog or services built mainly on it. This makes it source-available rather than OSI open source; GitHub shows the licence as "Other". |
| Tenancy | Multi-tenant from day one |
| First market | IT compliance and IT tasks |
| Stack | Postgres; TypeScript backend on Express; Drizzle ORM; Nuxt frontend; pg-boss for scheduled jobs, with workers as a separate deployment; Better Auth for authentication. pnpm workspace monorepo with a source-only shared library; API bundled with tsdown. |
| Layout | All app and package code lives under a root `src/` folder (`src/apps`, `src/packages`); the Nuxt app keeps the Nuxt 4 `app/` layout |
| Tooling | ESLint with Stylistic across all packages, styled by one shared config. In the web app `@nuxt/eslint` covers Nuxt and Vue rules only, with its Stylistic and other external tooling disabled (Nuxt-specific style overrides only where needed). TanStack Query in the frontend. |
| Hosting | Kubernetes, so Docker images are built for it. Migrations run as a separate Job in production, with an opt-in setting to run them on startup in dev and staging. |
| Scripts | Cross-platform only, since development may happen on Windows or Unix |
| Rendering | Nuxt renders the UI only: SSR allowed, no server routes; all data goes through the Express API |
| UI | Use a mature component framework rather than building our own; Nuxt UI chosen |
| AI use | Assistive, not replacing. Rules in [AGENTS.md](../AGENTS.md). |
| Competitor research | Work from what is known; unknown cells stay unknown |
| Data model | See the [database structure plan](plans/db-structure.md): TypeIDs for every key; Better Auth teams shown as Groups; permissions from member roles plus per-template access, with group roles later; skippable steps need a reason; app-level tenant isolation for the MVP |
| Commits | Single-line Conventional Commits for everyone, people and agents: `type(scope): summary`, no body or trailers |
| Dependency updates | Renovate, with a dependency dashboard. Major upgrades need approval on the dashboard, except GitHub Actions, whose majors are raised directly. GitHub Actions are pinned to digests. Minor and patch updates are grouped: one group each for Docker, GitHub Actions and Node packages. |

## Open

- Register domains and the `checklog-app` GitHub org (deferred until the MVP)
