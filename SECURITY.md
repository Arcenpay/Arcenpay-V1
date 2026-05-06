# Security Policy

## Reporting a Vulnerability

**Do not open a public issue.** Report security vulnerabilities directly to the security team:

- Email: `support@arcenpay.com`
- Include detailed steps to reproduce
- Allow up to 48 hours for acknowledgment and 7 days for a fix

We follow a responsible disclosure process and will credit researchers who report valid vulnerabilities (with permission).

---

## Supported Versions

| Version | Supported |
|---------|-----------|
| `main` (latest) | Yes |
| All other branches | No |

---

## Security Practices

### Secrets Management

- **Never commit `.env` files** — they are in `.gitignore`
- Use `.env.example` as a template for required variables
- All private keys and API keys must be rotated if ever exposed
- Use environment-specific secrets (never share keys between dev/staging/prod)
- CI secrets are stored in GitHub Secrets — never hardcoded in workflow files

### Authentication

- Dashboard sessions use HMAC-SHA256 token hashes stored in httpOnly cookies
- API keys are stored as SHA-256 hashes (never plaintext)
- Facilitator internal routes require `FACILITATOR_SECRET` bearer token
- x402 payments use EIP-712 signatures with SHA-256 replay protection

### Smart Contracts

- All contracts audited by Slither static analysis in CI
- `onlyBiller` / `onlyProvider` access controls on sensitive functions
- Fee calculation uses basis points to avoid floating-point precision loss
- Reentrancy guards on cross-contract calls
- Upgrade capability restricted to governance multisig

### API Security

- CORS origins configured via `CORS_ORIGINS` env var — never wildcard in production
- Rate limiting on auth endpoints, invite endpoints, and x402 payment routes
- Request body size limited to 50KB on facilitator
- All user input validated with Zod schemas before processing
- SQL queries use parameterized statements (Prisma / `$1` bind parameters)

### Dependency Management

- Dependencies pinned in `package-lock.json`
- CI runs `npm ci` to ensure lockfile integrity
- Renovate/Dependabot configured for automated security updates
- Slither analysis catches vulnerable Solidity patterns

---

## Security Architecture

For a detailed security architecture overview, see:
- `docs/WIKI.md` — Authentication and authorization flows
- `apps/facilitator/src/server.ts` — x402 middleware validation and replay protection
- `apps/arcen-dashboard/lib/embed-access-token.ts` — Embed token generation and verification
- `packages/sdk-node/src/middleware/x402.ts` — On-chain payment verification

---

## Compliance

- Smart contract deployments verified on Etherscan/Basescan
- Fee calculations use basis points (BPS) with `BPS_DENOMINATOR = 10000`
- Gas sponsorship per-transaction limit: $0.50 USD (configurable)
- Platform tiers enforce hard limits on plans, subscribers, and gas budget
