# Security Policy

## Reporting a Vulnerability

**Do not open a public issue.** Report security vulnerabilities directly to the security team:

- Email: `security@arcenpay.com`
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
- x402 payments use EIP-712 signatures with replay protection

### Smart Contracts & Programs

- Shared deployment constants and ABIs live in `packages/internal-core`
- On-chain programs enforce `onlyBiller` / `onlyProvider`-style access controls on sensitive instructions
- Fee calculation uses basis points to avoid floating-point precision loss
- Reentrancy and account-substitution guards on cross-program calls

### API Security

- CORS origins configured via `CORS_ORIGINS` env var — never wildcard in production
- Rate limiting on auth, invite, and x402 payment routes
- All user input validated with Zod schemas before processing
- SQL queries use parameterized statements (Prisma / `$1` bind parameters)

### Dependency Management

- Dependencies pinned in `package-lock.json`
- CI runs `npm ci` to ensure lockfile integrity
- Dependabot configured for automated security updates (`.github/dependabot.yml`)

---

## Security Architecture

For a detailed security architecture overview, see:

- `apps/arcen-backend/src/middleware/auth.ts` — API key and session authentication
- `apps/arcen-dashboard/lib/embed-access-token.ts` — Embed token generation and verification
- `packages/sdk-node/src/middleware/x402.ts` — On-chain payment verification

---

## Compliance

- Smart contract deployments verified on Etherscan/Basescan
- Fee calculations use basis points (BPS) with `BPS_DENOMINATOR = 10000`
- Platform tiers enforce hard limits on plans, subscribers, and gas budget
