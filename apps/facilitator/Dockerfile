# ============================================================
#  MEAP Facilitator Node — Production Docker Build
#  x402 payment validation + settlement + billing automation
# ============================================================

FROM node:20-alpine AS builder

WORKDIR /repo

# Install workspace dependencies
COPY package*.json turbo.json tsconfig.base.json ./
COPY packages ./packages
COPY apps/facilitator ./apps/facilitator
RUN npm ci

# Build required workspaces in dependency order
RUN npm run -w @meap/core build \
  && npm run -w @meap/node build \
  && npm run -w @meap/facilitator build

# Keep runtime deps only
RUN npm prune --omit=dev

FROM node:20-alpine AS runner

WORKDIR /repo
ENV NODE_ENV=production

# Create non-root user for security
RUN addgroup --system --gid 1001 meap && \
    adduser --system --uid 1001 facilitator --ingroup meap

COPY --from=builder /repo/package*.json ./
COPY --from=builder /repo/node_modules ./node_modules
COPY --from=builder /repo/packages ./packages
COPY --from=builder /repo/apps/facilitator/package.json ./apps/facilitator/package.json
COPY --from=builder /repo/apps/facilitator/dist ./apps/facilitator/dist

USER facilitator

EXPOSE 3402

HEALTHCHECK --interval=30s --timeout=10s --start-period=5s --retries=3 \
  CMD wget --no-verbose --tries=1 --spider http://localhost:3402/health || exit 1

CMD ["node", "apps/facilitator/dist/server.js"]
