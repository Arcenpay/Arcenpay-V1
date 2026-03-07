# ArcenPay Production GA Plan (Big-Bang Release, 16-20 Weeks)

## Summary
ArcenPay will ship as a single GA release with a **balanced dual-track** scope: strong self-serve billing plus core enterprise controls.  
GA scope is locked to:
- Crypto-first billing on **Base mainnet (prod)** and **Sepolia (staging/dev)**.
- **USDC-first** pricing and settlement.
- Catalog with **Plans + Add-ons + Credits**.
- **Template library first** (internal curated marketplace), implemented as JSON schema + reusable React blocks.
- **Tax-ready PDF invoices** with numbering, email delivery, and full status tracking.
- Enterprise controls anchored on **fixed-role RBAC + audit log**.
- ZKVUB available as a **controlled beta** (not broad self-serve GA).
- Compliance baseline for **US + India**.
- **No mock/local-only fallbacks** in production paths.

## Locked Scope and Non-Goals
### In Scope
- Full billing catalog UX parity (plans, add-ons, credits, configuration).
- Invoice engine, delivery, retries, history, and resend.
- Email/webhook reliability with durable logs.
- Production RBAC and immutable audit trail for all sensitive actions.
- Environment mode with explicit Dev/Testnet vs Production/Mainnet behavior.
- Chain/token guardrails and safe rollout controls.
- Production readiness gates across security, testing, observability, and incident ops.

### Out of Scope for GA
- Fiat rails at launch (planned post-GA).
- Public third-party component marketplace.
- Custom role builder (fixed roles only).
- Broad multi-chain/multi-token beyond Base/Sepolia + USDC.
- Full ZKVUB general availability.

## Phase Plan (Single GA, No Public Release Before Final Cut)
1. **Weeks 1-2: Foundation Hardening**
- Replace all placeholder/unsafe defaults in runtime-critical paths.
- Add complete env contract for dashboard/facilitator/subgraph with startup validation.
- Remove UI local-only persistence from production settings flows.
- Fix dashboard test infra with deterministic test DB wiring.
- Add “production mode forbids fallback” assertions in app startup and health endpoints.

2. **Weeks 3-6: Billing Domain and Catalog**
- Add first-class data model for catalog: plans, add-ons, credits, pricing rules, environment-scoped versions.
- Add provider onboarding flow that handles on-chain provider registration pre-checks.
- Upgrade plan creation/editing to support selectable approved token list (USDC at GA) and no hardcoded token constants.
- Build catalog pages and APIs: Plans, Add-ons, Credits, Configuration.
- Add versioning and publish workflow for catalog changes (draft → published).

3. **Weeks 5-9: Template Library (Marketplace v1)**
- Implement template entities: `BillingTemplate`, `BillingTemplateVersion`, `TemplateInstall`.
- Template format: JSON schema + React block composition + style tokens.
- Build template library UI: browse, preview, clone, install, diff versions.
- Add SDK renderer contract so installed templates can be embedded consistently in client apps.
- Add template compatibility checks per environment and chain.

4. **Weeks 7-11: Invoice and Notification System**
- Add invoice domain: `Invoice`, `InvoiceLine`, `InvoiceDelivery`, `CreditNote`, `TaxProfile`, `InvoiceSequence`.
- Implement invoice number strategy per workspace: `INV-{workspace}-{YYYY}-{seq}`.
- Build PDF generation pipeline with object storage persistence and signed download URLs.
- Implement event-to-invoice flow from facilitator billing events with idempotency keys.
- Send invoices and receipts via Resend with retry/backoff and delivery status tracking.
- Add invoice center UI with search/filter/download/resend and timeline.

5. **Weeks 9-13: Enterprise Controls**
- Add fixed roles: `OWNER`, `ADMIN`, `FINANCE`, `DEVELOPER`, `SUPPORT`.
- Add permission matrix enforcement to all mutating dashboard APIs.
- Implement append-only audit log for user/API actions with request ID, actor, diff, IP, user-agent, timestamp.
- Build audit log UI (filter by actor/type/date, API vs user actions, export CSV).
- Complete team invite flow with actual email invitation delivery and acceptance trail.

6. **Weeks 11-15: Network Mode, Chain/Token Operations, Reliability**
- Add workspace environment mode switch with explicit confirmation and safeguards.
- Separate config/data views by environment to avoid testnet/mainnet confusion.
- Add chain readiness checks that block writes when required addresses are unset/zero.
- Add durable webhook delivery storage and replay from persisted log (not in-memory only).
- Add billing event durability and replay protections across facilitator restarts.
- Add SLO dashboards, alerting, and runbook-linked remediation actions.

7. **Weeks 14-18: Security, Performance, Compliance Validation**
- Execute smart contract and backend security review cycle.
- Run role/permission abuse tests, webhook signature validation tests, and invoice tamper checks.
- Validate US and India invoice/tax fields and document formatting requirements.
- Run load tests for event ingestion, invoice generation, and email/webhook throughput.
- Complete disaster recovery drills for queue backlog, mail provider outage, and RPC degradation.

8. **Weeks 19-20: GA Cutover**
- Freeze schema and APIs.
- Run full production dress rehearsal.
- Migrate production config and secrets.
- Execute final go/no-go checklist and launch.

## Architecture and Implementation Decisions
- Use existing Postgres/Prisma as system of record for catalog, invoice, audit, and delivery logs.
- Keep facilitator as event ingestion runtime, but persist operationally critical records durably in DB-backed stores.
- Use an explicit async job layer for invoice/email/webhook processing with idempotent workers.
- Keep subgraph as primary analytics source with direct-chain fallback for critical checks.
- Enforce strict separation between environment modes in both backend APIs and UI state.

## Public API / Interface / Type Changes
### Dashboard APIs (new/expanded)
- `GET/POST/PUT /api/catalog/plans`
- `GET/POST/PUT /api/catalog/add-ons`
- `GET/POST/PUT /api/catalog/credits`
- `GET/POST /api/catalog/publish`
- `GET/POST /api/templates`
- `GET/POST /api/templates/{id}/install`
- `GET /api/invoices`
- `GET /api/invoices/{id}`
- `POST /api/invoices/{id}/resend`
- `GET /api/audit-log`
- `POST /api/environment/switch`

### Facilitator APIs (new/expanded)
- Durable billing event ingestion endpoint with idempotency.
- Invoice trigger/event status endpoints.
- Persistent webhook log endpoints with replay by delivery ID.
- Health endpoint extensions for queue depth, email backlog, and invoice worker status.

### SDK Changes
- `@meap/core` types:
  - `PaymentToken`, `EnvironmentMode`, `BillingTemplate`, `InvoiceSummary`, `AuditEvent`.
- `@meap/react` additions:
  - `TemplateRenderer`, `InvoiceList`, and typed hooks for invoice/audit/template state.
- Backward compatibility:
  - Existing components remain, with deprecations documented and migration guide published.

## Data Model Additions
- `CatalogPlan`, `CatalogAddOn`, `CatalogCreditType`, `CatalogVersion`.
- `BillingTemplate`, `BillingTemplateVersion`, `TemplateInstall`.
- `Invoice`, `InvoiceLine`, `InvoiceDelivery`, `CreditNote`, `TaxProfile`, `InvoiceSequence`.
- `AuditEvent` (append-only).
- `WebhookDelivery` (durable), `BillingEvent` (idempotent ingest ledger).

## Quality Gates and Test Scenarios
- Wallet checkout end-to-end on Sepolia and Base with USDC.
- Plan/add-on/credit publish flow and rollback behavior.
- Template clone/install/render parity across environments.
- Invoice generation correctness for renewal, cancellation, proration, and credit notes.
- Invoice email delivery retry and manual resend.
- Unauthorized RBAC attempts across all protected endpoints.
- Audit log completeness for every mutating action.
- Webhook signature validation and replay safety.
- Facilitator restart resilience with no lost billing events.
- Chain misconfiguration guardrails (zero address, wrong chain, wrong token).
- Performance tests for bulk invoice runs and webhook bursts.
- Security tests for session, key management, and privilege escalation.
- Regression tests for dashboard APIs and SDK public contracts.

## Release Acceptance Criteria
- All GA APIs stable and documented.
- 0 critical or high unresolved security findings.
- 99.9% successful invoice generation in dress rehearsal.
- 99% webhook delivery success within retry window.
- Audit log coverage for 100% of mutating actions.
- No production path depending on local-only fallback state.
- Complete runbooks and on-call dashboards operational.

## Assumptions and Defaults
- Big-bang public GA is required (no staged public rollout).
- Delivery window is 16-20 weeks.
- Base mainnet is production chain; Sepolia is staging/dev.
- USDC is only GA billing token; USDT/ETH are post-GA expansions.
- Crypto-first only for GA; fiat is post-GA.
- Template library is internal curated v1, not public marketplace.
- ZKVUB is controlled beta at GA.
- Compliance baseline targets US + India invoice/tax documentation.
- AGENTS skills listed in workspace are not applicable to this product-planning task.

