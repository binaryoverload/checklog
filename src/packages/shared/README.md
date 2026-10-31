# @checklog/shared

TypeScript types and Zod validation schemas shared by `src/apps/api` and `src/apps/web`.

There is no build step: `exports` points at `src/index.ts`, and each app compiles it as part of its own build.
