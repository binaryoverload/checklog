# syntax=docker/dockerfile:1
# Web image. Build from the repo root: docker build -f docker/web.Dockerfile .

FROM node:24-trixie-slim AS base
ENV PNPM_HOME=/pnpm
ENV PATH=$PNPM_HOME:$PATH
# Installs the pnpm version pinned in package.json's packageManager field
RUN corepack enable
WORKDIR /repo

FROM base AS build
COPY . .
RUN --mount=type=cache,id=pnpm-store,target=/pnpm/store \
    pnpm install --frozen-lockfile --store-dir /pnpm/store --filter "@checklog/web..."
RUN pnpm --filter @checklog/web build

FROM node:24-trixie-slim AS runtime
ENV NODE_ENV=production
ENV HOST=0.0.0.0
ENV PORT=3000
WORKDIR /app
# Nuxt's .output is self-contained: it bundles the server and its dependencies
COPY --from=build /repo/src/apps/web/.output ./.output
USER node
EXPOSE 3000
CMD ["node", ".output/server/index.mjs"]
