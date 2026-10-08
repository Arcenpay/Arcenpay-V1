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

### Solana Programs (Rust / Anchor)

- Anchor 0.30+ with the `arclang` / SPL conventions used in `packages/solana-programs`
- All instruction handlers must validate accounts explicitly — never trust client input
- Use checked arithmetic (`checked_add`, `checked_sub`) for every balance mutation
- Run `cargo clippy` and `anchor test` before opening a PR

### ZK Circuits (Circom)

- Circuits live in `circuits/` — keep constraint counts documented in `circuits/artifact-manifest.json`
- Every circuit change must regenerate proving keys and update the manifest
- Add a corresponding fixture under `circuits/test/`

### General

- No `console.log` in production code — use the shared `logger` utility
- Environment variables accessed via `@/lib/config` (dashboard) or `config.ts` (backend)
- API responses use the standardized `apiError` / `apiSuccess` helpers
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

### Program Tests (Anchor / cargo)

```bash
cd packages/solana-programs
anchor test
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
fix(backend): handle empty plan list in billing keeper
chore(deps): update viem to v2.17
docs(readme): add deployment guide
```

Types: `feat`, `fix`, `chore`, `docs`, `refactor`, `test`, `perf`, `ci`, `style`

---

## CI/CD

All pushes and PRs run the workflow matching the paths they touch:

- **CI** (`ci.yml`) — builds the shared packages, verifies the vendored `internal/core` copies are in sync, typechecks/tests/builds the SDK packages, and runs the hygiene gate
- **Solana Programs** (`solana.yml`) — `cargo check` and `cargo test` for the Anchor program
- **Hygiene gate** — unfinished-marker check (`scripts/check-unfinished.sh`)

---

## Documentation

- **Code comments**: Explain _why_, not _what_. The code should be self-documenting for what it does.
- **API routes**: Must have JSDoc describing auth requirements and response shape.
- **Architecture decisions**: Describe them in the pull request; persistent docs live in the hosted documentation site.

---

## Getting Help

- Documentation → [docs.arcenpay.com](https://docs.arcenpay.com)
- Questions & discussion → open a GitHub Discussion
- Security issues → see [SECURITY.md](./SECURITY.md)
