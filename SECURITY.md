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

- `onlyBiller` / `onlyProvider` access controls on sensitive functions
- Fee calculation uses basis points to avoid floating-point precision loss
- Reentrancy guards on cross-contract calls
- A Slither configuration is included at `packages/contracts/slither.config.json`. It is **not yet wired into CI**, and the contracts have **not** had an independent third-party audit. Run Slither locally before any production upgrade.
- **Upgrade authority is centralized today.** The EVM contracts are UUPS proxies; `owner()` on the BOT Chain Mainnet `PlanFactory` and `SubscriptionRegistry`, and `treasury()` on `FeeCollector`, all resolve to the deployer address `0x0453E6675bFE21B1499CF66361278F39a85850E4` (verified on-chain). Migrating that role to a governance multisig is planned and is a prerequisite for describing upgrades as multisig-controlled.
- **Solana:** the program upgrade authority and the on-chain `Config` admin are the same single key, `8rJPx5E5CZkDxvW1WGeyQFQhSDkH55vxx98HKCFwnP34` (ProgramData `HsKrcZ1jBJzry27Hu3RJRfvNdKRRnuVk9Bfnw71LWCQZ`). Moving this to a multisig is likewise planned.
- **Solana settlement trust model:** `settle` is restricted to an authorized settler (the facilitator) and replay-protected by a 32-byte nullifier. The optional Groth16 proof gate is **off by default**, so until a verifier is deployed and enabled the facilitator is a trusted settler. See `packages/solana-programs/README.md`.

### Deployment Trust Model

Disclosing the current trust assumptions is part of the security posture:

| Surface | Current authority | Status |
|---|---|---|
| BOT Chain Mainnet EVM contracts | `0x0453E6675bFE21B1499CF66361278F39a85850E4` (single key) | Multisig migration planned |
| Solana Mainnet program + config | `8rJPx5E5CZkDxvW1WGeyQFQhSDkH55vxx98HKCFwnP34` (single key) | Multisig migration planned |
| Treasury (BOT Chain) | `0x0453E6675bFE21B1499CF66361278F39a85850E4` | Same key as admin |
| Treasury (Solana) | `3hoVJKNDP9zpHvxizcKGYzZL2ZeTaBTZ2m2p68Wi9Tmv` | Separate from admin |

Until the multisig migration lands, treat protocol admin keys as a single point of failure and rotate them if exposure is suspected.

### API Security

- CORS origins configured via `CORS_ORIGINS` env var — never wildcard in production
- Rate limiting on auth endpoints, invite endpoints, and x402 payment routes
- Request body size limited to 50KB on facilitator
- All user input validated with Zod schemas before processing
- SQL queries use parameterized statements (Prisma / `$1` bind parameters)

### Dependency Management

- Dependencies pinned in `package-lock.json`
- CI runs `npm ci` to ensure lockfile integrity
- Dependency updates are currently applied manually; Dependabot/Renovate is not configured yet
- Run Slither (`packages/contracts/slither.config.json`) before contract releases

---

## Security Architecture

For a detailed security architecture overview, see:
- `docs/WIKI.md` — Authentication and authorization flows
- `apps/facilitator/src/server.ts` — x402 middleware validation and replay protection
- `apps/arcen-dashboard/lib/embed-access-token.ts` — Embed token generation and verification
- `packages/sdk-node/src/middleware/x402.ts` — On-chain payment verification

---

## Compliance

- EVM deployments are verified on the relevant explorer where the chain supports it (BOTScan for BOT Chain, BaseScan for Base Sepolia, ArcScan for Arc Testnet). Solana uses the Solana Explorer.
- Fee calculations use basis points (BPS) with `BPS_DENOMINATOR = 10000`
- Gas sponsorship per-transaction limit: $0.50 USD (configurable)
- Platform tiers enforce hard limits on plans, subscribers, and gas budget
