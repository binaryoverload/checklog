# syntax=docker/dockerfile:1
# API image. Build from the repo root: docker build -f docker/api.Dockerfile .
# Runs the API by default; the pg-boss worker deployment overrides the command with
# ["node", "dist/worker.mjs"].

FROM node:24-trixie-slim AS base
ENV PNPM_HOME=/pnpm
ENV PATH=$PNPM_HOME:$PATH
# Installs the pnpm version pinned in package.json's packageManager field
RUN corepack enable
WORKDIR /repo

FROM base AS build
COPY . .
RUN --mount=type=cache,id=pnpm-store,target=/pnpm/store \
    pnpm install --frozen-lockfile --store-dir /pnpm/store --filter "@checklog/api..."
RUN pnpm --filter @checklog/api build
# Standalone folder with only the API's production dependencies
RUN --mount=type=cache,id=pnpm-store,target=/pnpm/store \
    pnpm deploy --filter @checklog/api --prod --store-dir /pnpm/store /out

FROM node:24-trixie-slim AS runtime
ENV NODE_ENV=production
WORKDIR /app
# Files stay owned by root so the app can't modify its own code
COPY --from=build /out/package.json ./package.json
COPY --from=build /out/node_modules ./node_modules
COPY --from=build /repo/src/apps/api/dist ./dist
# Migration files for the migrate Job
COPY --from=build /repo/src/apps/api/drizzle ./drizzle
USER node
EXPOSE 3001
CMD ["node", "dist/index.mjs"]
