# Contributing to Checklog

Thanks for helping. Checklog is licensed under the [GNU AGPLv3 with the Commons Clause](LICENSE); by contributing you agree your work is released under those terms.

## Getting started

You need Node 24+, pnpm (via `corepack enable`) and Postgres.

```bash
pnpm install
cp .env.example .env
pnpm dev:api
pnpm dev:web
```

## Before opening a PR

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
