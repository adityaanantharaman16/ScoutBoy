FROM node:20-alpine AS dependencies

ENV PNPM_HOME=/pnpm
ENV PATH=$PNPM_HOME:$PATH
WORKDIR /app
RUN corepack enable

COPY package.json pnpm-lock.yaml pnpm-workspace.yaml ./
COPY apps/web/package.json ./apps/web/package.json
RUN pnpm install --frozen-lockfile

FROM node:20-alpine AS builder

ENV PNPM_HOME=/pnpm
ENV PATH=$PNPM_HOME:$PATH
WORKDIR /app
RUN corepack enable

COPY --from=dependencies /app/node_modules ./node_modules
COPY --from=dependencies /app/apps/web/node_modules ./apps/web/node_modules
COPY package.json pnpm-lock.yaml pnpm-workspace.yaml ./
COPY apps/web ./apps/web

ARG NEXT_PUBLIC_API_BASE_URL=http://localhost:8000/api
ENV NEXT_PUBLIC_API_BASE_URL=$NEXT_PUBLIC_API_BASE_URL \
    SCOUTBOY_NEXT_STANDALONE=1
RUN pnpm --filter @scoutboy/web build

FROM node:20-alpine AS runner

ENV NODE_ENV=production \
    NEXT_TELEMETRY_DISABLED=1
WORKDIR /app
RUN addgroup --system --gid 1001 scoutboy && adduser --system --uid 1001 --ingroup scoutboy scoutboy

COPY --from=builder --chown=scoutboy:scoutboy /app/apps/web/.next/standalone ./
COPY --from=builder --chown=scoutboy:scoutboy /app/apps/web/.next/static ./apps/web/.next/static

USER scoutboy
EXPOSE 3000
ENV HOSTNAME=0.0.0.0 \
    PORT=3000
CMD ["node", "apps/web/server.js"]
