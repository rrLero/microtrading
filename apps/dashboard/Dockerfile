# Read-only dashboard (Railway: RAILWAY_DOCKERFILE_PATH=apps/dashboard/Dockerfile).
# Next bakes rewrites at build time, so AGENT_API_URL must be present during the build.
FROM node:22-alpine
RUN corepack enable
WORKDIR /repo
COPY pnpm-workspace.yaml package.json pnpm-lock.yaml ./
COPY apps/dashboard/package.json apps/dashboard/
RUN pnpm install --frozen-lockfile --filter @microtrading/dashboard
COPY apps/dashboard ./apps/dashboard
ARG AGENT_API_URL
ENV AGENT_API_URL=$AGENT_API_URL NODE_ENV=production
RUN pnpm --filter @microtrading/dashboard build
WORKDIR /repo/apps/dashboard
CMD ["sh", "-c", "exec node_modules/.bin/next start -p ${PORT:-3002}"]
