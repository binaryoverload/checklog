# Checklog

A self-hostable tool for process logging and compliance: repeatable and ad hoc checklists with assignees, due dates, notes, approvals and an audit trail.

> Early development. Nothing here is usable yet.

## Repository layout

| Path                  | What it is                                                        |
| --------------------- | ----------------------------------------------------------------- |
| `src/apps/api`        | Express API with Drizzle, Better Auth and pg-boss workers         |
| `src/apps/web`        | Nuxt frontend with Nuxt UI and TanStack Query                     |
| `src/packages/shared` | Shared TypeScript types and validation schemas, shipped as source |
| `docs`                | Decisions, implementation notes and MVP scope                     |

## Development

```bash
pnpm install
cp .env.example .env
pnpm dev:api     # http://localhost:3001
pnpm dev:web     # http://localhost:3000
```

See [CONTRIBUTING.md](CONTRIBUTING.md) and the AI use rules in [AGENTS.md](AGENTS.md).

## Licence

Checklog is licensed under the [GNU AGPLv3 with the Commons Clause](LICENSE).

In short: you can use, modify and self-host Checklog for free, including inside a business, and share your changes under the same terms. The Commons Clause removes the right to **sell** Checklog: you may not charge third parties for a product or service whose value comes entirely or substantially from Checklog, including paid hosting, support or consulting for it.

Because of the Commons Clause, Checklog is source-available rather than open source as defined by the OSI.
