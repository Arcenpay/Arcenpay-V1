#!/usr/bin/env bash
set -e

echo "=== [Railway Backend Release] Running Prisma Database Migrations ==="
npx prisma migrate deploy --schema=apps/arcen-backend/prisma/schema.prisma

echo "=== [Railway Backend Release] Starting Server ==="
exec node --import tsx apps/arcen-backend/dist/server.js
