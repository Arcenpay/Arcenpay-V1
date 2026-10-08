# @arcenpay/backend

Core billing engine and REST API for ArcenPay. Built with **Hono v4**, **Prisma v7**,
and **PostgreSQL**, and consumed by the provider dashboard and the SDKs.

## Stack

| Concern | Technology |
| :--- | :--- |
| HTTP | Hono v4 (`@hono/node-server`) |
| ORM | Prisma v7 (`@prisma/adapter-pg`) |
| Datastore | PostgreSQL 16 |
| Cache / queue | Redis 7 (`ioredis`) |
| Validation | Zod |
| Email | Resend |
| Webhooks | Svix-compatible HMAC signatures |

## Scripts

```bash
npm run dev --workspace=@arcenpay/backend      # tsx watch on :3300
npm run build --workspace=@arcenpay/backend    # prisma generate && tsc
npm run test --workspace=@arcenpay/backend     # vitest
npm run typecheck --workspace=@arcenpay/backend
```

## Environment

Copy the repository root `.env.example` to `.env` and set at minimum `DATABASE_URL`,
`SIWE_JWT_SECRET`, and `ACCESS_TOKEN_SECRET`. See `apps/arcen-backend/.env.example`
for the backend-specific keys.

## Layout

```
src/
├── routes/v1/    # Versioned REST surface (billing, entitlements, webhooks, …)
├── middleware/   # Auth, rate limiting, and global guards
├── utils/        # Shared helpers
├── config.ts     # Centralized env resolution & production validation
└── server.ts     # HTTP entrypoint
prisma/           # Schema and migrations
```
