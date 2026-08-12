# MicroTrading agent — multi-stage build (SPEC §8: Docker on a small EU VPS)
FROM node:22-alpine AS build
RUN corepack enable
WORKDIR /repo
COPY pnpm-workspace.yaml package.json pnpm-lock.yaml turbo.json tsconfig.base.json ./
COPY packages/core/package.json packages/core/
COPY apps/agent/package.json apps/agent/
RUN pnpm install --frozen-lockfile
COPY packages ./packages
COPY apps/agent ./apps/agent
COPY experiments ./experiments
RUN pnpm build

FROM node:22-alpine
RUN corepack enable
WORKDIR /repo
ENV NODE_ENV=production
COPY --from=build /repo/package.json /repo/pnpm-workspace.yaml /repo/pnpm-lock.yaml ./
COPY --from=build /repo/packages/core/package.json packages/core/
COPY --from=build /repo/apps/agent/package.json apps/agent/
RUN pnpm install --frozen-lockfile --prod
COPY --from=build /repo/packages/core/dist packages/core/dist
COPY --from=build /repo/apps/agent/dist apps/agent/dist
# The pre-registered universe (SPEC §2.2) is read at runtime by the spread
# sampler, so it has to ship with the image — not just exist in the repo.
COPY --from=build /repo/experiments experiments
WORKDIR /repo/apps/agent
# .env is NOT baked in — pass config via environment (compose env_file)
CMD ["node", "dist/main.js"]
