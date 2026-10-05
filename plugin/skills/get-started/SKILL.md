---
name: get-started
description: Use when the user asks about their ArcenPay billing account — companies, plans, subscriptions, entitlements, invoices, payment links, mandates, or supported chains.
---

# ArcenPay

ArcenPay is a billing and entitlement platform for Web3 subscriptions. This
connection is **read-only**: it can look up account data, but it never changes
billing state and never moves funds.

## Workflow

1. Call `get_account` first to confirm which team and environment you are acting on.
2. Use `list_companies` to find a company, then `get_company`,
   `get_subscription`, or `check_entitlement` for details about it.
3. Use `list_plans` and `list_addons` to see what the workspace offers.
4. Use `list_invoices` / `get_invoice` for billing documents, and
   `get_invoice_download_url` when the user needs the PDF.
5. Use `list_chains` to answer settlement and network questions, and
   `get_mandate_status` / `get_settlement_status` for agent authorization state.
6. Use `list_payment_links` / `get_payment_link_spec` to inspect payment links.

## Rules

- Never claim to have changed a plan, issued a refund, or moved funds — this
  connection cannot do any of those.
- If a request needs a write action (create a payment link, change a plan, issue
  a mandate, refund an invoice), say it requires the ArcenPay dashboard or the
  ArcenPay SDK, and do not attempt it.
- Keep every answer scoped to the connected account; never present another
  team's data.
- Prefer stable ids from earlier results when chaining calls.
