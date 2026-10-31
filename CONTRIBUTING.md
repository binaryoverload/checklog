# Contributing to Checklog

Thanks for helping. Checklog is licensed under the [GNU AGPLv3 with the Commons Clause](LICENSE); by contributing you agree your work is released under those terms.

## Getting started

You need Node 24+, pnpm (via `corepack enable`) and Docker, which runs Postgres for development (`docker-compose.yaml`). If port 5432 is already taken, set `POSTGRES_PORT` before `pnpm db:up` and use the same port in `DATABASE_URL`. `pnpm db:down` stops it; data is kept in a Docker volume.

```bash
pnpm install
cp src/apps/api/.env.example src/apps/api/.env
cp src/apps/web/.env.example src/apps/web/.env
pnpm db:up
pnpm dev:api
pnpm dev:web
```

## Before opening a PR

CI runs the same checks on every pull request and push to `main`, and also builds both Docker images.

```bash
pnpm lint
pnpm typecheck
pnpm build
```

## AI use

Agents assist; people write Checklog's core logic. The full rules are in [AGENTS.md](AGENTS.md) and apply to everyone. In short:

- Agents may write boilerplate, config, CI, tests (reviewed by a person), docs, and behaviour-neutral refactors.
- Agents may not write business logic, the data model or API behaviour, including auth, the audit log and migrations, and may not apply fixes to application code.
- Tick the AI-use box in the PR template and say what it was used for.

## Commits

Every commit message is a single line in [Conventional Commits](https://www.conventionalcommits.org/) form: `type(scope): summary`, with no body or trailers. This applies to people and AI agents alike.

- Types: `feat`, `fix`, `docs`, `style`, `refactor`, `perf`, `test`, `build`, `ci`, `chore`, `revert`
- Scopes (optional): `api`, `web`, `shared`, `deps`, `docs`
- Breaking changes: add `!` after the type or scope, e.g. `feat(api)!: rename run endpoints`

## Style

ESLint with Stylistic enforces formatting; there is no Prettier. `pnpm lint:fix` fixes most issues. Keep scripts cross-platform.
