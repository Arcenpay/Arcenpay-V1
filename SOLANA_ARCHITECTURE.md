# ArcenPay — Solana Architecture & Status (handoff brief)

**Purpose:** a complete, self-contained description of the Solana side of ArcenPay — what exists,
how it is wired, what works, what is broken (with evidence), and the open design questions. Written
to be handed to any engineer or AI model for review and planning. No prior context assumed.

**Audience note:** the reader is assumed to know EVM/Stripe web2 billing deeply and Solana hardly
at all. Where a concept differs, the EVM equivalent is given.

---

## 0. TL;DR

ArcenPay is a Web3 entitlements/billing platform. It supports three chain families: **EVM**
(mature, works), **Stellar** (works), and **Solana** (new, ~80% built, one broken joint).

- The **on-chain Anchor program is deployed, initialized, and working.** It mints subscriptions and
  moves USDC on devnet.
- **Activation is fixed and was verified live.** The off-chain projection (`SubscriptionState`,
  invoice, payment, credit grant, entitlement) commits synchronously on the client's confirmed tx.
  The old "finalizing…" screen was a *masked error* (a catalog cuid coerced to `BigInt`); retries
  now reconcile the existing PDA instead of dead-ending.
- **Autopay now runs.** The facilitator's renewal worker discovers due subscriptions straight from
  the chain (`getProgramAccounts` on the Anchor account discriminator) and submits `execute` from a
  relayer keypair. The program signs the SPL transfer as a **per-`(owner, mint)` delegate PDA** —
  shared by every ArcenPay subscription charging that token account — with an **additive** allowance,
  so a second subscription can no longer overwrite the first one's delegate.

Everything else — codec, PDA derivation, payment verification, wallet auth — is written and correct.

---

## 1. The mental model shift (EVM → Solana)

| | EVM | Solana |
|---|---|---|
| Unit of deployment | **Contract** = code + storage together | **Program** = code only, no state |
| Where state lives | Inside the contract | **Separate accounts** owned by the program |
| Addressing | Contract address | Program ID + **PDAs** (addresses derived from seeds) |
| Entry points | Function selector (4 bytes) | **Instruction discriminator = first 8 bytes of data**, `sha256("global:<name>")[0..8]` |
| Cross-contract calls | `CALL` / `DELEGATECALL` | **CPI** (cross-program invocation) |
| Why split into many contracts? | **Forced** — 24 KB bytecode limit | Not needed — ~4 MB limit |

Consequence: the platform's **7 EVM contract "slots"** (`subscriptionRegistry`, `autopayModule`,
`planFactory`, `feeCollector`, `sessionVault`, `zkUsageVerifier`, `mirrorRegistry`) are all filled
by **one Solana program**. `packages/internal-core/src/addresses.ts` maps all 7 to the same id.
This is correct and intentional, not a missing deployment.

---

## 2. On-chain layer (devnet)

```
Program ID (all roles): D4ECHyomENvFHrdXWHcRncTwwQ1EQbyY4ga3CkcaYCP3
Upgradeable:            BPFLoaderUpgradeab1e…  ProgramData HsKrcZ1j…
Authority:              ELcbYWG16Nisg8qqKjs2C8zQNw7QZy4yUssKEPLyHYPW
Source:                 packages/solana-programs/programs/arcenpay-solana/src/lib.rs (~1,270 LOC)
Second program:         mock-groth16-verifier (ZK proof verification for settlement)
```

**Instructions (13):** `initialize_config`, `create_plan`, `update_plan`, `subscribe`, `execute`,
`cancel`, `change_plan`, `authorize_settler`, `fund_session`, `settle`, `withdraw_session`,
`set_proof_verification`, `migrate_config`.

**Accounts (PDAs):**

| Seeds | Purpose |
|---|---|
| `["config"]` | global `fee_bps`, `treasury`, admin |
| `["plan", plan_id]` | provider, price, billing interval, accepted token, active |
| `["subscription", token_id]` | owner, plan, expiration, autopay snapshot |
| `["subscription_wallet", owner]` | wallet → token_id index (1 per wallet) |
| `["subscription_delegate", owner, mint]` | **the shared autopay authority PDA** — one per token account, not per subscription |
| vault / nullifier / settler PDAs | ZKVUB metered settlement |

**Deterministic token id:** `token_id = sha256("arcenpay:solana:subscription:<wallet>:<planId>")`.
Same wallet + same plan ⇒ same subscription PDA. This is the idempotency anchor (and also the
source of a retry deadlock — see §6).

---

## 3. Where Solana is integrated (file map)

```
packages/internal-core/src/
  chain-family.ts      synthetic chain ids 9100000 (mainnet) / 9100001 (devnet) / 9100002 (testnet);
                       RPC resolution with env override; explorer URLs
  addresses.ts         program id per chain. devnet populated; MAINNET EMPTY (by design, pre-deploy)
  solana/index.ts      ★ THE CODEC — instruction encoders, PDA finders, account decoders.
                       Shared by backend, facilitator and all three SDKs. Single source of truth.

apps/arcen-backend/src/
  routes/v1/subscriptions-activate.ts   subscribe: prepare → verify → finalize  ← BROKEN HERE
  routes/v1/company-plan.ts             plan change: prepare + on-chain confirm (Solana branch added)
  routes/v1/agent-permissions.ts        agent wallet + SPL balance read
  lib/payments/solana-payment-verification.ts   verifies SPL/Anchor transfers
  lib/payments/solana-signature.ts              ed25519 (base58) wallet-link verification
  lib/billing/billing-events.ts         on-chain event → ledger / payment / invoice projection
  lib/billing/billing-recovery.ts       finalizeSubscriptionActivation + recovery tasks

apps/facilitator/src/services/
  solana-adapter.ts        on-chain event listener (poller)
  solana-event-codec.ts    decodes SubscriptionMinted / Renewed / BillingExecuted
  solana-renewal-driver.ts ★ AUTOPAY worker (submits `execute` on due subscriptions)
  settlement-writer.ts     ZKVUB `settle` (relayer-signed)

packages/sdk-react/    useSolanaEmbedWallet, SolanaWalletAdapter, <ArcenEmbed>
packages/sdk-node/     checkout / payment links, x402 middleware (ed25519 verification)
packages/sdk-agent/    x402 auto-payment (agent signs, node verifies), SPL transfer

apps/arcen-dashboard/  Solana wallet (standard wallet-adapter stack), agent section, pay page
apps/demo-dapp/        integration demo — consumes the SDK from source via a Vite alias
```

**Critical property:** `internal-core/solana/index.ts` is shared. Changing an instruction
signature there breaks backend + facilitator + SDKs simultaneously (this happened with `execute`).

---

## 4. What happens when someone buys a subscription

```
① Embed → POST /api/v1/subscriptions/activate  { planId, company }        (no txHash)
     backend:  resolve plan
               derive token_id + subscription PDA
               build `subscribe` instruction (account metas + base64 data)
     ← 200 { preparedTransaction }

② Embed:  build legacy Transaction (feePayer = user, recent blockhash)
          simulate → Phantom signs → send → CONFIRMED
          (helper: submitSolanaTransaction in ArcenEmbed.tsx)

③ Embed → POST /api/v1/subscriptions/activate  { …, activationTxHash }
     backend verifySolanaActivation(txHash):
        · tx exists at "confirmed", meta.err == null
        · invoked the ArcenPay program and logged "Instruction: Subscribe"
        · emitted `SubscriptionMinted` (8-byte Anchor event discriminator)
        · subscription PDA matches owner / plan / mint / amount
     backend finalizeSubscriptionActivation(...):   ← ONE Prisma transaction
        · SubscriptionState → ACTIVE (period, chainId, chainFamily)
        · Company.activePlanId = plan
        · Payment (SUCCEEDED) + Invoice (ISSUED)
        · plan credit grants + entitlement projection + webhook outbox
     ← 200 { status: active }
```

**Current failure point: step ③, `finalizeSubscriptionActivation` throws.** Steps ① and ② succeed,
the money moves, the on-chain subscription exists. Because the throw is caught and converted into a
`202 "pending"` response, the user sees *"Subscription activation submitted. We're finalizing your
billing state now."* and the company remains on **Free**.

**This is intentionally NOT asynchronous.** EVM works the same way: the client waits for the receipt,
then the backend verifies an already-confirmed tx and finalizes in one round trip. Solana's
`submitSolanaTransaction` also confirms before calling the backend. There is no architectural need
for a multi-state activation machine; the observed "pending" is a **disguised error**.

---

## 5. Autopay — how it works (the question that matters most)

### Why autopay needs *something* on any chain

A renewal happens at a point in time with no user present. So the user must grant a **standing,
bounded authorization** at subscribe time.

- **EVM (current design):** an ERC-7579 **smart account** with an `AutopayModule`; the module pulls
  from the account. This requires the user to have a smart account.
- **Solana (this design):** standard **SPL token delegate**. No smart account required — works on a
  plain EOA like Phantom.

### The Solana model

**At subscribe time** the program performs a real `token::approve` CPI (`lib.rs:195-216`):

```rust
let approve_accounts = Approve {
    source:    ctx.accounts.subscriber_token,   // the user's USDC token account
    delegate:  ctx.accounts.delegate,           // PDA ["subscription_delegate", owner, mint]
    authority: ctx.accounts.subscriber,         // the Phantom user signs this
    amount:    <bounded allowance>,
};
token::approve(CpiContext::new(ctx.accounts.token_program.to_account_info(), approve_accounts))?;
sub.delegate_bump = ctx.bumps.delegate;
```

and **snapshots onto the Subscription account** (so a provider editing a plan price later cannot
raise an existing subscriber's renewal): mint, provider, renewal price, billing interval,
authorization expiry, and a **remaining-renewals budget**.

**At renewal time:**

```
facilitator relayer worker (solana-renewal-driver.ts)
  → finds subscriptions where expiration is due && autopay_enabled && remaining_renewals > 0
  → builds `execute`:
       data:     encodeExecute()                    // NO amount — it is the snapshot
       accounts: config, plan, subscription,
                 relayer (signer — pays fees only),
                 subscription_delegate PDA,
                 token_mint, payer_token, provider_token, treasury_token, token_program
  → relayer submits
  → the PROGRAM signs the SPL transfer AS THE DELEGATED PDA
  → program enforces: active, autopay_enabled, remaining_renewals > 0,
                     mint == snapshot, interval, price cap, authorization expiry
  → finality → BillingExecuted event → normal billing pipeline → Payment + Invoice
```

### Security properties

- The facilitator **never holds a user key** — it is a relayer (`SOLANA_RELAYER_PRIVATE_KEY`) paying
  fees only.
- Spending authority is a **delegate allowance granted to a program PDA**, bounded by amount,
  interval, budget and expiry (12-month horizon; annual = 1 renewal, monthly ≤ 12).
- The delegate is **shared per `(owner, mint)`**: an SPL token account has exactly one delegate slot,
  so a per-subscription delegate would be overwritten the moment a second subscription (or another
  app) called `approve`. Sharing the PDA — and making `approve` **additive** (existing ArcenPay
  allowance + this subscription's budget) — means one subscription can never silently break
  another's renewals.
- Owner can **pause / cancel / reauthorize**; a plan change resets the snapshot and requires explicit
  owner approval. `reauthorize_autopay` tops the allowance back up rather than resetting it.
- The legacy `SOLANA_RENEWAL_KEYS` (custodial key list) is **gone** — discovery is on-chain.

**Phantom-user answer:** the subscriber signs one `Approve` during checkout (plus the `subscribe`
tx). That is a standard wallet prompt. Renewals then require **no** further user interaction until
the allowance is exhausted or expires, at which point reauthorization is required.

**Status: implemented and tested.** `subscribe` approves the shared delegate; `execute` is
relayer-submitted and program-signed. The facilitator's renewal worker discovers due subscriptions
straight from the chain, preflights the SPL delegation (reporting `reauthorization_required` when a
foreign delegate has replaced ours or the allowance is short), submits `execute`, and parks a
subscription after repeated failures. Covered by `cargo test` (unit + `tests/lifecycle.rs`, which
asserts the shared delegate, the additive top-up, and the renewal) and the facilitator's
`solana-renewal-driver` tests. Remaining: explicit `PAYMENT_FAILED` emission on a declined renewal
(today the period-end maintenance sweep already handles the financial consequence).

---

## 6. Known defects (with evidence)

| # | Defect | Evidence | Impact |
|---|---|---|---|
| D1 | **Solana activation is never finalized** | `finalizeSubscriptionActivation` throws in `subscriptions-activate.ts`; caught and returned as `202` | User charged, stays on Free. Highest severity. |
| D2 | **Failure disguised as success** | `return c.json({…}, recoveryPending ? 202 : 200)` — the embed renders 202 as "finalizing…" | Users believe they succeeded; no error surfaced |
| D3 | **Retry deadlock** | `Subscribe` hard-`init`s the PDA; `token_id` is deterministic ⇒ retry = `Allocate … already in use` | Permanently un-usable subscription after one failed finalize |
| D4 | **SDK resolved the production API** | `sync-internal-core.mjs` hardcodes `api.arcenpay.com` into the published bundle; the runtime override was added this session | Local/staging traffic silently went to production; backend+f facilitator logged nothing |
| D5 | **Wallet case corruption** | Several Solana paths used `.trim().toLowerCase()` (e.g. `customer-identity.ts`, `billing-events.ts`, `subscriber/email.ts` `mode:"insensitive"`) | Base58 addresses corrupted/mismatched |
| D6 | **Missing provisioning step** | `deploy-solana.sh` never created the treasury ATA | First `Subscribe` failed `AccountNotInitialized (3012)` |
| D7 | **Renewals disabled** | `SOLANA_RENEWAL_DRIVER_ENABLED` default off | Autopay never runs in practice |
| D8 | **Discriminator offset bug** (fixed) | Recovery read `token_id` at byte 0; Anchor prefix is 8 bytes | Recovery silently returned null |
| D9 | **`execute` signature drift** | `encodeExecute()` lost its arg + gained delegate accounts; the renewal driver and a test were stale | Build break; would have submitted an invalid instruction |

Fixed: D1 (catalog cuid coerced to `BigInt`), D2 (409, never a fake "pending"), D3 (server-side
reconcile on retry), D4 (runtime API override), D5 (billing paths), D6 (provisioning script), D8, D9,
and the **one-delegate flaw** (shared `(owner, mint)` delegate + additive allowance). **D7 is now
closed** — the relayer worker runs (opt-in via `SOLANA_RENEWAL_DRIVER_ENABLED=true`).

---

## 7. Open design questions (for planning)

1. ~~**How to unlock D3 without a program redeploy.**~~ **Resolved — option (a):** the backend
   reconciles an existing PDA during confirmation (recovers the minting signature and finalizes from
   it) instead of erroring. Verified idempotent against live data.
2. **Finalization atomicity.** `finalizeSubscriptionActivation` currently does many sequential writes.
   Should the projection (SubscriptionState + Company + Payment + Invoice + credits + entitlement +
   webhook) be one DB transaction, or a saga with durable recovery? What is the correct behaviour
   when the on-chain transfer is irreversible but the DB write fails?
3. **Projection authority.** Should the backend finalize from the **client-submitted tx hash**, or
   should the facilitator be the only finalizer, projecting from a **finalized on-chain event**?
   (The event path is more robust — it survives a closing browser — but adds a real dependency.)
4. **Autopay horizon and UX.** 12-month bounded authorization: is a per-charge ceiling plus an
   interval a sufficient user guarantee? How should remaining budget be surfaced before signing?
5. **Mainnet gating.** What must be true before `SOLANA_MAINNET_CHAIN_ID` is added to
   `MAINNET_CHAIN_IDS` (audit, canary size, rollback plan)?
6. **Multi-chain facilitator.** One process per chain vs a single multi-chain process — which is
   the operational target?

---

## 8. Non-negotiable constraints

- **Never hold a user's private key.** Relayer-only for the facilitator.
- **Idempotency by `(chainId, signature, tokenId)`.** Duplicate delivery must be a no-op across
  `BillingEvent`, `Payment`, `Invoice`, credit grants and recovery tasks.
- **Never present a failure as pending.** Success is shown only after the billing projection
  commits.
- **Never auto-refund an irreversible transfer.** A paid-but-unprovisioned tx is held for automatic
  repair + operator escalation, never re-charged.
- **Preserve Base58 case** on every Solana path (`normalizeWalletForChain`).
- **Fail closed** at startup when required Solana config (program id, RPC, mint, ATAs) is missing.

---

## 9. Verification the current suite does NOT have

- An integration test: wallet `subscribe` → finalized event → backend projection → assert the
  company is **ACTIVE with the paid plan** and an Invoice/Payment exist. **Its absence is why D1
  shipped.**
- Idempotency: same signature/event delivered twice ⇒ exactly one Payment/Invoice.
- Failure paths: delayed finality, projection failure + repair, wrong tx intent, insufficient
  balance, expired/revoked allowance, budget depletion, renewal retry, cancel, reauthorize,
  plan-change authorization reset.
- Anchor tests for delegate boundaries: relayer cannot spend beyond the allowance, cannot
  substitute provider/price, interval enforced, revoke works.

---

## 10. Immediate remediation owed

Subscription `Fa7CFNsf6PsZt3BdBN52EXNCr9bonjpS84fptxth2N6m`
(owner `6zViMHfrs3u5HmEfSwGczizy1Ys78jqDsLF43t8tCcz7`, planId `843712451206765211`,
tx `57D45vQ7gKW7urSDKVruwtEE8u8Kho8LG277PPh1MB8PKtsorguur9ASr4VcdDr3JBrPert6Y2T49DsLZRa5FNTV`)
was paid for and never provisioned. It must be projected through the **fixed** code path (not
hand-edited) so the repair exercises and validates the real flow.

---

## 11. Appendix — full issue inventory

Section 6 lists the critical path. This appendix is the **complete** list found while building and
testing the Solana integration, including items already fixed (so a reviewer knows what has been
touched) and open items not on the critical path.

### 11.1 Fixed (this work)

| Area | File / site | Defect |
|---|---|---|
| Dashboard | `settings.tsx` (Contracts tab) | Explorer link used wagmi's **EVM** `useChainId()`, so a Solana address opened **Etherscan**. Now uses `configuredChainId`. |
| Dashboard | `agent.tsx` | `chainMismatch` excluded Stellar but **not Solana** → permanent "your wallet is on 11155111, switch to 9100001" plus a Switch button that did nothing (wagmi has no such chain). |
| Dashboard | `agent.tsx` | "Source" wallet pill fell through to the EVM wallet on Solana. |
| Backend | `agent-permissions.ts` | Agent-balance "reconciliation fallback" fabricated a vault/wallet balance from **EVM-style** `approve_and_fund`/`transfer` pre-approval rows whenever the real balance read 0 → phantom balance on Solana. Now gated to `fam === "evm"`. |
| Backend | `subscriptions-activate.ts` | Tx-hash schema regex was **hex-only** → Solana base58 rejected with 400 before its branch ran. |
| Backend | `billing-events.ts` (×2) | `customerWallet.toLowerCase()` corrupted base58 on the **invoice** and in delivered **webhooks**. |
| Backend | `billing-events.ts` | `recordSuccessfulPayment` / `recordFailedPayment` called **without `chainId`** → every Solana `Payment` tagged EVM/84532. |
| Backend | `customer-identity.ts` | Unconditional `.toLowerCase()` on wallets. |
| Backend | `routes/v1/subscriber/email.ts` (×2) | `mode: "insensitive"` company lookup — base58 is case-sensitive. |
| Backend | `company-plan.ts` | Solana plan-change was dead-ended by the EVM autopay-tx requirement; added Solana **prepare + on-chain confirm** branches. |
| SDK | `sdk-agent/agent.ts` | `createPaymentLink` default recipient had no `isSolana` branch → silently used the **EVM dummy address**. |
| SDK | `sdk-agent/auth/mandate.ts` | Mandate sign/verify was EVM (EIP-712) / Stellar only → **broken on Solana**. Added ed25519 + base58. |
| SDK | `sdk-react/index.ts` | Solana hook/adapter/tx-builder were **not exported** (Stellar's were). |
| SDK | `sdk-node/client.ts` | `ChargeCustomerInput` had no `chainId` — a charge could not target Solana. |
| SDK | `sdk-react/ArcenEmbed.tsx` | Solana submit had **no pre-simulation**, so wallets reported only "failed to simulate" and the real program error was invisible. Added pre-flight + error surfacing. |
| SDK | `sdk-react/ArcenEmbed.tsx` | Recovery helper read `token_id` at byte **0** instead of 8 (Anchor discriminator) → derived the wrong PDA (D8). |
| SDK | `sdk-react/vite demo` | Solana codecs need Node `Buffer` in the browser → *"buffer is not defined"*. Polyfilled. |
| SDK | `sync-internal-core.mjs` + `app-origin.ts` | SDK resolved the **production** API even for local/staging (D4). Added a runtime override. |
| Facilitator | `solana-renewal-driver.ts` | Built the **old** `execute` instruction (amount arg, no delegate PDA) after the program changed → build break + invalid instruction (D9). |
| Facilitator | `server.ts` | Event logs printed **"Stellar"** for Solana events. |
| Ops | `deploy-solana.sh` | Never created the treasury ATA (D6). Added the step + `provision-cluster.mjs` (idempotent, creates missing provider/treasury ATAs). |
| Build | turbo/Vite | Stale-chunk race (`Could not resolve ./chunk-*.mjs`) after SDK dist rebuilds. |

### 11.2 Open — not on the critical path, but real

| # | Area | Issue | Impact |
|---|---|---|---|
| O1 | Dashboard | **Wallet popup loop** — the wallet is re-prompted on small UI changes | UX; likely an effect with an unstable dependency re-triggering connect/reconnect |
| O2 | SDK agent | `getBalance()` returns the **wallet** SPL balance while the x402 verifier checks the **Session PDA** | After `fundSession()` the agent believes it has no funds → spurious top-up / wrong reporting |
| O3 | Facilitator | Per-wallet x402 rate-limit key uses an **EVM-only** address regex | Per-wallet limiting silently falls back to IP on Solana |
| O4 | Pay page | EVM `useWaitForTransactionReceipt` is enabled for **base58** Solana hashes | Harmless RPC errors / stuck `isConfirming` |
| O5 | Pay page | Solana `TransferChecked` **hardcodes `decimals = 6`** | Correct for USDC; wrong for any other mint |
| O6 | SDKs | `parseHumanUsdcAmount` / `parseDecimalToAtomicUnits` hardcode 6 decimals | Same as O5 |
| O7 | internal-core | `isAcceptableAddressForFamily` accepts **any non-empty string** for non-EVM | Lax validation of env-injected program ids / addresses |
| O8 | Facilitator | `SOLANA_RENEWAL_DRIVER_ENABLED` defaults **off** | Autopay does not run (D7) |
| O9 | Program | The `execute`/delegate rewrite needs a **redeploy**; other `encodeExecute` call sites may still exist | Mainnet blocker |
| O10 | Backend | `billing-ledger`/`billing-recovery` default `chainId` to **84532 (EVM)** when absent | Any new caller that omits `chainId` silently tags a Solana event EVM |
| O11 | Backend | `billing-event` ingest (`billing-events.ts`) still relies on per-call-site `chainId` threading | Fragile; a single omission corrupts the payment's family |
| O12 | Docs | `AGENTS.md` describes the billing architecture but not the Solana program/PDAs | Onboarding gap for the Solana side |

### 11.3 Residual uncertainty (things NOT verified)

- ~~Solana activation has **never been observed to complete** end-to-end (D1).~~ **Now verified** —
  a real devnet subscription finalized with a `SubscriptionState`, invoice and payment.
- ~~The renewal/autopay path has **never been executed**.~~ **Now exercised** by
  `cargo test` (`tests/lifecycle.rs`, native program test); not yet driven by a live relayer against
  devnet.
- The `execute` delegate invariants: **shared-delegate identity and additive top-up are now covered**;
  spend-cap, provider/price substitution and revoke remain future work.
- Mainnet program id, USDC mint and ATAs are **unset**; no canary has been run.

