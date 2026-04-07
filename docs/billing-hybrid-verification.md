# Billing Hybrid Verification

This runbook turns the payment/autopay/invoice verification plan into a repeatable repo workflow.

## What It Covers

- Focused automated baseline tests in `apps/arcen-dashboard`, `packages/sdk-node`, and `packages/sdk-react`
- Env alignment checks across dashboard, facilitator, demo, and root invoice config
- Live activation against `POST /api/v1/subscriptions/activate`
- On-chain confirmation that the payment account now maps to a subscription token
- Dashboard DB confirmation for company plan sync, billing-event processing, and invoice creation
- Public signed invoice download verification
- Customer-facing invoice visibility via embed access token + component render API
- Negative checks for missing autopay, wrong-plan mismatch, and billing-event idempotency replay
- Evidence capture to `docs/production/evidence`

## What It Does Not Claim

- Timed recurring renewal is not proven by this pass.
- Real renewal still depends on `BillingKeeper` plus a near-expiry subscription and is a separate verification exercise.

## Prerequisites

1. Start local infra from the repo root:

```bash
docker compose up -d
```

2. Start the local apps in separate terminals:

```bash
cd apps/arcen-dashboard && npm run dev
```

```bash
cd apps/facilitator && npm run dev
```

```bash
cd apps/arcen-demo && npm run dev
```

3. Make sure the env files are populated:

- `.env`
- `apps/arcen-dashboard/.env`
- `apps/facilitator/.env`
- `apps/arcen-demo/.env.local`

4. Choose a payment account that already has autopay installed and configured for the same on-chain plan and merchant.

## Commands

Run only the focused baseline:

```bash
npm run verify:billing:baseline
```

Run only env alignment:

```bash
npm run verify:billing:env
```

Run the live verification:

```bash
npm run verify:billing:live -- --payment-account 0xYOUR_ACCOUNT
```

Run everything:

```bash
npm run verify:billing:all -- --payment-account 0xYOUR_ACCOUNT
```

Useful optional flags:

- `--plan-id <on_chain_plan_id>` to force a specific paid published plan
- `--wrong-plan-id <on_chain_plan_id>` to force the wrong-plan negative check target
- `--subscriber-email you@example.com` to use a stable invoice recipient
- `--component-id <embed_component_id>` if you do not want auto-resolution
- `--dashboard-url http://localhost:3000`
- `--facilitator-url http://localhost:3402`
- `--demo-url http://localhost:3001`
- `--label custom-run-name`
- `--evidence-dir docs/production/evidence`
- `--allow-existing-subscription` if the payment account already has a token and you still want to continue

## Evidence Output

Each run writes a JSON evidence bundle:

```text
docs/production/evidence/billing-hybrid-<mode>-<label>.json
```

The evidence includes:

- baseline test results with stdout/stderr
- env alignment report
- activation request and response
- on-chain token verification
- DB verification for company, billing event, and invoice
- signed invoice download result
- customer-facing invoice visibility result
- negative-check results

## Notes

- The live verifier uses the dashboard API key to resolve the owning team and auto-select the newest active published paid plan when `--plan-id` is omitted.
- The wrong-plan negative check is skipped if the team only has one active published paid on-chain plan and no `--wrong-plan-id` is supplied.
- The signed invoice download check uses the same HMAC shape as the dashboard public download route, so it verifies the real public invoice artifact path without requiring dashboard session cookies.
