# Agent guidelines

These rules apply to every AI coding agent working in this repository, and to the people using them. They apply equally to the core team and to outside contributors.

**Agents assist; people write Checklog's core logic.**

## What agents may do

- Write boilerplate and do project setup
- Write config and CI (Docker, pipelines, linting, tooling), and apply fixes to them directly
- Make behaviour-neutral refactors (renames, moving files, updating imports) when tests still pass
- Write tests, with a person reviewing every test before merge
- Write docs and READMEs
- Plan work: phases, next steps, drafting issues
- Review PRs, but a person writes and posts the review comments

## What agents may not do

- **Write core logic.** Business logic, the data model and API behaviour are written by a person. This already covers auth, the audit log and migrations, so there are no extra no-go areas.
- **Build UI screens.** Pages and the components that make up a feature's UI are written by a person. Agents may set up the app shell (layout, navigation, shared helpers and plugins) and other UI boilerplate.
- **Apply fixes to application code.** An agent explains the fix or shows a diff, and a person applies it.

When a task would cross these lines, stop and say so. Leave a `TODO` marking where the person's code goes instead of writing it.

## Disclosure and enforcement

- The PR template has a checkbox asking whether AI was used, and for what. Fill it in honestly.
- Breaches are handled at the reviewer's discretion.

## AI inside Checklog

The same principle applies to AI features in the product: product AI may suggest and draft (for example a template from a written procedure), but a person confirms before anything is saved or a step is completed.

## Project conventions

- **Layout:** pnpm workspace. `src/apps/api` (Express, Drizzle, Better Auth, pg-boss), `src/apps/web` (Nuxt, Nuxt UI, TanStack Query), `src/packages/shared` (types and validation schemas shipped as TypeScript source, no build step).
- **Dependencies:** shared versions live in the `catalog:` in `pnpm-workspace.yaml`. Apps depend on the shared package with `workspace:*`.
- **Scripts must be cross-platform.** Development happens on Windows and Unix. `pnpm-workspace.yaml` enables `shellEmulator`; anything longer than a one-liner is a small Node script.
- **Comments:** only where the code isn't self-explanatory, or where it departs from the norm or a default for a reason. One or two concise sentences, describing the code as it is now: no history, past decisions or conversation context.
- **Linting:** one ESLint config with Stylistic (`eslint.shared.js`); no Prettier. Run `pnpm lint` and `pnpm typecheck` before handing work back.
- **Frontend:** Nuxt renders the UI only. No Nuxt server routes; all data goes through the Express API via TanStack Query (not `useFetch`).
- **Configuration:** environment variables only. Each app has its own `.env.example`; in development the API loads its `.env` with the `dotenv` package and Nuxt loads its own. Production never reads `.env` files.
- **Commits:** single-line [Conventional Commits](https://www.conventionalcommits.org/), for example `feat(api): add run scheduling` or `chore: update renovate config`. Subject line only: no body and no trailers. Use a `!` after the type for breaking changes (`feat(api)!: ...`).
- **To do:** [`docs/todo.md`](docs/todo.md) is the running list of work. Tick items off and add new ones as part of finishing a task.
- **Decisions:** see [`docs/decisions.md`](docs/decisions.md) and [`docs/implementation-notes.md`](docs/implementation-notes.md) before proposing changes to the stack.
