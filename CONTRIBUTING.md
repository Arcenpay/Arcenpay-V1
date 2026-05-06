# Contributing to ArcenPay

This document outlines the standards and workflows for contributing to the ArcenPay codebase.

---

## Code Standards

### TypeScript

- Strict mode enabled across all packages
- No `any` types without explicit justification in comments
- Use `const` assertions and `satisfies` operator where possible
- Prefer `interface` for object types, `type` for unions/intersections
- Exhaustive switch statements with `default: never` for enum-like types

### React / Next.js

- Server Components by default; `"use client"` only where necessary
- Colocate tests with source using `__tests__/` directories
- Use React 19 patterns (no forwardRef unless wrapping a class component)
- Error boundaries on every route segment

### Solidity

- Solidity 0.8.26+ with optimizer enabled (1000 runs)
- All external/public functions must have `@notice` NatSpec
- Use Foundry for testing, Hardhat for deployment
- Slither analysis runs in CI — zero `high` severity findings allowed

### General

- No `console.log` in production code — use the shared `logger` utility
- Environment variables accessed via `@/lib/config` (dashboard) or `validatedConfig` (facilitator)
- API responses use standardized `apiError` / `apiSuccess` helpers from `@/lib/api-response`
- Error messages must not leak stack traces or internal paths in production

---

## Branch Strategy

| Branch | Purpose |
|--------|---------|
| `main` | Production-ready code — all tests pass, deployable |
| `develop` | Integration branch — features merged here for testing |
| `feature/*` | Feature branches — one per feature/ticket |
| `fix/*` | Bug fix branches |
| `release/*` | Release preparation branches |

### Pull Request Requirements

- All CI checks must pass (typecheck, lint, test, build)
- PR title follows: `[type] description` (e.g., `[fix] handle empty plan list`)
- Description must include what changed and why
- Breaking changes must be called out explicitly
- At least one reviewer approval required for `main`

---

## Testing

### Unit Tests (Vitest)

```bash
# Run all unit tests
npm run test

# Run specific package tests
npm run test -- --filter=@arcenpay/react

# Watch mode
npm run test -- --watch
```

Test files go in `__tests__/` directories adjacent to the code they test. Naming convention: `{module}.test.ts`.

### Contract Tests (Foundry)

```bash
cd packages/contracts
forge test -vvv
```

### E2E Tests (Playwright)

```bash
cd apps/arcen-dashboard
npx playwright test
```

---

## Commit Guidelines

Follow [Conventional Commits](https://www.conventionalcommits.org/):

```
type(scope): description

feat(sdk-react): add subscription pause/resume support
fix(facilitator): handle empty plan list in billing keeper
chore(deps): update viem to v2.17
docs(readme): add deployment guide
```

Types: `feat`, `fix`, `chore`, `docs`, `refactor`, `test`, `perf`, `ci`, `style`

---

## CI/CD

All pushes and PRs run:
- **Hygiene gate** — unfinished marker check
- **TypeScript check** — `tsc --noEmit` across changed packages
- **Lint** — Prettier format check + ESLint where configured
- **Tests** — Vitest (SDK + dashboard), Foundry (contracts)
- **Build** — Verify all packages and apps compile
- **Slither** — Static analysis on Solidity contracts
- **Subgraph** — Codegen + build check

Push to `main` additionally triggers:
- Docker image build for facilitator
- E2E Playwright tests for dashboard

---

## Documentation

- **Code comments**: Explain _why_, not _what_. The code should be self-documenting for what it does.
- **API routes**: Must have JSDoc describing auth requirements and response shape.
- **Architecture decisions**: Document in `/docs/` with date prefix (e.g., `2026-05-06-rate-limiting-strategy.md`).
- **Runbook updates**: If you change a deployment or operational procedure, update the relevant runbook.

---

## Getting Help

- Architecture questions → `docs/WIKI.md`
- On-call procedures → `docs/OPERATIONS_RUNBOOK.md`
- Incident response → `docs/INCIDENT_RUNBOOK.md`
