# ArcenPay GA Migration Notes

## New API Surface

- `GET/POST/PUT /api/catalog/plans`
- `GET/POST/PUT /api/catalog/add-ons`
- `GET/POST/PUT /api/catalog/credits`
- `POST /api/catalog/publish`
- `GET/POST/PUT /api/templates`
- `GET/POST /api/templates/{id}/install`
- `GET/POST /api/invoices`
- `GET /api/invoices/{id}`
- `GET /api/invoices/{id}/download`
- `POST /api/invoices/{id}/resend`
- `GET /api/invoices/public/{id}/download` (signed public token)
- `GET /api/audit-log`
- `POST /api/environment/switch`

## New Domain Models

The dashboard database now includes catalog entities, template entities, invoice entities,
audit events, durable billing events, and durable webhook delivery logs.

## RBAC Changes

Team roles now support:

- `OWNER`
- `ADMIN`
- `FINANCE`
- `DEVELOPER`
- `SUPPORT`
- `MEMBER`

## Production Behavior Changes

- Settings local-storage persistence is disabled outside development.
- Plan creation resolves accepted token from chain configuration instead of using a hardcoded Sepolia token.
- Environment switching enforces contract readiness checks before allowing production mode.
- Invoice PDFs are now generated and persisted on first issuance/resend; customer download links are signed and time-bound.

## Required Invoice Runtime Env

- `INVOICE_STORAGE_DIR`
- `INVOICE_DOWNLOAD_SIGNING_SECRET`
- `INVOICE_DOWNLOAD_URL_TTL_SECONDS` (optional, defaults to `86400`)

## SDK Additions

`@meap/core` new types:

- `PaymentToken`
- `EnvironmentMode`
- `BillingTemplate`
- `InvoiceSummary`
- `AuditEvent`

`@meap/react` new components:

- `TemplateRenderer`
- `InvoiceList`

## Backward Compatibility

Existing SDK exports remain available. New APIs are additive. Existing clients can continue operating while adopting new flows incrementally.
