FROM node:20-alpine AS builder

WORKDIR /repo

# Install workspace dependencies
COPY package*.json turbo.json tsconfig.base.json ./
COPY packages ./packages
COPY apps/facilitator ./apps/facilitator
RUN npm ci

# Build required workspaces
RUN npm run -w @meap/core build \
  && npm run -w @meap/node build \
  && npm run -w @meap/facilitator build

# Keep runtime deps only
RUN npm prune --omit=dev

FROM node:20-alpine AS runner

WORKDIR /repo
ENV NODE_ENV=production

COPY --from=builder /repo/package*.json ./
COPY --from=builder /repo/node_modules ./node_modules
COPY --from=builder /repo/packages ./packages
COPY --from=builder /repo/apps/facilitator/package.json ./apps/facilitator/package.json
COPY --from=builder /repo/apps/facilitator/dist ./apps/facilitator/dist

EXPOSE 3402

HEALTHCHECK --interval=30s --timeout=5s --retries=3 \
  CMD wget -q -O /dev/null http://localhost:3402/health || exit 1

CMD ["node", "apps/facilitator/dist/server.js"]
