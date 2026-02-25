FROM node:20-alpine AS base

WORKDIR /app

# Install dependencies
COPY package*.json ./
RUN npm ci --production

# Copy source
COPY dist/ ./dist/

# Expose port
EXPOSE 3402

# Health check
HEALTHCHECK --interval=30s --timeout=3s --retries=3 \
  CMD wget -q -O /dev/null http://localhost:3402/health || exit 1

# Start
CMD ["node", "dist/server.js"]
