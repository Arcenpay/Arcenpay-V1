# ============================================================
#  ArcenPay Backend API — Production Docker Build
#  Hono v4 REST API + Prisma ORM + Platform Billing Engine
# ============================================================

FROM node:20-alpine AS builder

WORKDIR /repo

# OpenSSL and libc needed for Prisma engine
RUN apk add --no-cache openssl libc6-compat

# Copy dependency manifests
COPY package*.json turbo.json tsconfig.base.json ./
COPY packages ./packages
COPY apps/arcen-backend ./apps/arcen-backend

# Install all workspace dependencies
RUN npm ci

# Build required core workspaces and backend
RUN npm run build:backend

FROM node:20-alpine AS runner

WORKDIR /repo
ENV NODE_ENV=production

RUN apk add --no-cache openssl libc6-compat

# Create non-root user
RUN addgroup --system --gid 1001 arcen && \
    adduser --system --uid 1001 backend --ingroup arcen

COPY --from=builder /repo/package*.json ./
COPY --from=builder /repo/node_modules ./node_modules
COPY --from=builder /repo/packages ./packages
COPY --from=builder /repo/apps/arcen-backend ./apps/arcen-backend

USER backend

EXPOSE 3300

HEALTHCHECK --interval=30s --timeout=10s --start-period=5s --retries=3 \
  CMD wget --no-verbose --tries=1 --spider http://localhost:3300/health || exit 1

WORKDIR /repo/apps/arcen-backend

CMD ["node", "--import", "tsx", "dist/server.js"]
