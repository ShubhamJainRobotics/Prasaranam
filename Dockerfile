# ─── Multi-Stage Dockerfile for Relay ──────────────────────────────────────
# Targets: api, worker, web

# Stage 1: Base image
FROM node:24-bookworm-slim AS base
WORKDIR /app
RUN apt-get update && apt-get install -y --no-install-recommends \
    curl ca-certificates \
    && rm -rf /var/lib/apt/lists/*

# Stage 2: Dependencies and Builder
FROM base AS builder
WORKDIR /app

# Copy root and workspace package files for dependency caching
COPY package*.json ./
COPY apps/api/package.json ./apps/api/
COPY apps/worker/package.json ./apps/worker/
COPY apps/web/package.json ./apps/web/
COPY packages/contracts/package.json ./packages/contracts/
COPY packages/database/package.json ./packages/database/
COPY packages/test-fixtures/package.json ./packages/test-fixtures/

# Install all dependencies including devDependencies for build
RUN npm ci

# Copy tsconfigs and source code
COPY tsconfig*.json ./
COPY packages ./packages
COPY apps ./apps

# Build all typescript packages, contracts schemas, and web assets
RUN npm run build

# Prune devDependencies to keep production images minimal and lean
RUN npm prune --omit=dev

# ─── Target: api ─────────────────────────────────────────────────────────────
FROM base AS api
WORKDIR /app
ENV NODE_ENV=production \
    PORT=4000

# Copy node_modules and built dist directories from builder
COPY --from=builder /app/node_modules ./node_modules
COPY --from=builder /app/packages ./packages
COPY --from=builder /app/apps/api ./apps/api
COPY --from=builder /app/package.json ./package.json

# Run as unprivileged node user
USER node

EXPOSE 4000

HEALTHCHECK --interval=30s --timeout=5s --start-period=5s --retries=3 \
  CMD node -e "fetch('http://localhost:4000/health/live').then(r => process.exit(r.ok ? 0 : 1)).catch(() => process.exit(1))"

CMD ["node", "apps/api/dist/server.js"]

# ─── Target: worker ──────────────────────────────────────────────────────────
FROM base AS worker
WORKDIR /app
ENV NODE_ENV=production

# Copy node_modules and built dist directories from builder
COPY --from=builder /app/node_modules ./node_modules
COPY --from=builder /app/packages ./packages
COPY --from=builder /app/apps/worker ./apps/worker
COPY --from=builder /app/package.json ./package.json

USER node

CMD ["node", "apps/worker/dist/index.js"]

# ─── Target: web ─────────────────────────────────────────────────────────────
FROM base AS web
WORKDIR /app
ENV NODE_ENV=production \
    PORT=5173

# Copy web dist assets and the lightweight zero-dependency production static server
COPY --from=builder /app/apps/web/dist ./apps/web/dist
COPY --from=builder /app/apps/web/serve.js ./apps/web/serve.js

USER node

EXPOSE 5173

HEALTHCHECK --interval=30s --timeout=5s --start-period=5s --retries=3 \
  CMD node -e "fetch('http://localhost:5173/health/live').then(r => process.exit(r.ok ? 0 : 1)).catch(() => process.exit(1))"

CMD ["node", "apps/web/serve.js"]
