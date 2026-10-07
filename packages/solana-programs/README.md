# ArcenPay Solana Program

Anchor implementation of the ArcenPay subscription-billing protocol for
Solana. It mirrors the EVM launch-runtime contracts
(`SubscriptionRegistry`, `PlanFactory`, `FeeCollector`,
`ERC7579AutopayModule`) as a single program so the facilitator's
`SolanaChainAdapter` decodes the **same five billing events** it decodes for
EVM and Stellar.

> **Status: DEPLOYED on Devnet; Mainnet pending.**
> Program id `D4ECHyomENvFHrdXWHcRncTwwQ1EQbyY4ga3CkcaYCP3` (Devnet, chainId
> `9100001`), registered in `packages/internal-core/src/addresses.ts`. The SBF
> build, 8 unit tests + a 2-case lifecycle suite (including the `settle` proof
> gate), the local-validator lifecycle, and the **Devnet** end-to-end lifecycle
> + settlement smokes all pass. Mainnet deploy is not done. `settle` supports an
> opt-in Groth16 proof gate (CPI into a verifier program, see below); it is off
> by default, where the trusted-settler + nullifier-replay model applies.

## Layout

```
packages/solana-programs/
├── Anchor.toml
├── Cargo.toml                     # Rust workspace
├── programs/arcenpay-solana/
│   ├── Cargo.toml
│   └── src/lib.rs                 # program + state + events + errors
├── tests/                         # Anchor integration tests (TS)
└── package.json
```

## PDAs

| Account | Seeds |
|---|---|
| `Config` | `["config"]` |
| `Plan` | `["plan", plan_id.to_le_bytes()]` |
| `Subscription` | `["subscription", token_id.to_le_bytes()]` |
| `SubscriptionByWallet` | `["subscription_wallet", owner]` |

The `Subscription` account field order is **load-bearing** — it is decoded
positionally by `apps/facilitator/src/services/solana-adapter.ts`:

```
owner(32) | token_id(u64) | plan_id(u64) | plan_tier(u8) | expiration(i64)
| active(bool) | minted_at(i64) | last_renewed_at(i64) | total_paid(u64) | bump(u8)
```

## Events

Decoded by the facilitator from Anchor `Program data:` log lines (8-byte
`sha256("event:<Name>")` discriminator + Borsh body). **Do not reorder fields** —
doing so silently breaks the facilitator decoder.

| Event | Fields (in order) |
|---|---|
| `SubscriptionMinted` | subscriber, token_id, plan_id, expiration |
| `SubscriptionRenewed` | token_id, new_expiration, amount_paid |
| `SubscriptionCancelled` | token_id |
| `SubscriptionPlanChanged` | token_id, previous_plan_id, new_plan_id, expiration |
| `BillingExecuted` | account, merchant, token_id, plan_id, reason(u8), gross_amount, merchant_amount, protocol_fee, timestamp |
| `BillingSettled` | session_id, agent, call_count, settlement_amount, window_start, window_end |
| `SettlerAuthorized` | settler |
| `SessionFunded` | session_id, agent, amount, balance |
| `SessionWithdrawn` | session_id, agent, amount, balance |

`reason`: `0` = activation, `1` = renewal (mirrors the EVM `BillingReason`).

## Fees

`SUBSCRIPTION_FEE_BPS = 50` (0.50%), `BPS_DENOMINATOR = 10_000`. A charge is
split into a net merchant transfer and a protocol-fee transfer to the treasury.

## Session vault (ZKVUB usage billing)

`authorize_settler` / `fund_session` / `settle` / `withdraw_session` implement the
prepaid-session leg that the EVM `SessionVault` provides, so x402 usage billing
can settle on Solana:

- `authorize_settler(settler)` — admin registers a settler PDA (`["settler", settler]`).
- `fund_session(session_id, amount)` — the agent pulls SPL from its ATA into the
  vault ATA (owned by the `["vault"]` PDA); creates/tops-up the
  `["session", agent, session_id]` account.
- `settle(amount, call_count, nullifier, proof, public_inputs)` — a registered
  settler moves funds from the vault ATA to the provider and emits
  `BillingSettled`. The vault transfer is signed by the vault-authority PDA. The
  32-byte `nullifier` is recorded in a `["nullifier", nullifier]` PDA, so the
  **same settlement cannot be applied twice** (double-spend guard, mirroring the
  EVM `usedNullifiers` check). An optional trailing account slot carries the
  verifier program (the program id signals `None`, per Anchor's optional-account
  convention).
- `set_proof_verification(required, verifier)` (admin-only) — toggles the `settle`
  ZK proof gate and sets the verifier program.
- `withdraw_session(amount)` — the agent reclaims remaining balance.

> **Trust model — opt-in ZK proof verification.** When
> `config.proof_verification_required` is `false` (the default) `settle` is
> settler-gated and replay-protected, and the authorized settler (the
> facilitator) is trusted to have validated usage off-chain. Setting it to
> `true` (via `set_proof_verification`) makes `settle` CPI into the configured
> `groth16_verifier` program — which must implement
> `verify(proof: Vec<u8>, public_inputs: Vec<u8>)`, failing the instruction when
> the proof is invalid — and reject the settlement if the CPI fails. This
> mirrors the EVM `ZKUsageVerifier` (verifier lives outside the billing
> program). A production verifier can be built on the `alt_bn128` syscalls
> (`solana_program::alt_bn128`) or the `groth16-solana` crate. Until one is
> deployed and enabled, the trusted-settler caveat applies and must be reflected
> in the security model / audit scope.

## Build & deploy

```bash
cd packages/solana-programs

# Host compile + unit tests (fee math, account layouts) — no Solana CLI needed
npm run check:cargo
npm run test:cargo     # 8 unit tests + the lifecycle integration test

# SBF build (produces target/deploy/arcenpay_solana.so)
npm run build:sbf

# SBF build + on-chain integration tests (requires the Anchor CLI)
anchor build
anchor test                       # uses the local validator

# Deploy (builds SBF, syncs declare_id! + Anchor.toml with the program
# keypair, deploys, and prints the env vars to register).
# Requires a funded payer keypair.
SOLANA_KEYPAIR=~/.config/solana/id.json npm run deploy:devnet
```

Deployment prerequisites (all satisfied except funding):
- Solana CLI + `cargo-build-sbf` on `PATH`.
- A **funded** payer keypair — devnet SOL comes from
  `solana airdrop 2 <pubkey> --url devnet` (the public faucet is rate-limited;
  use https://faucet.solana.com if the CLI is throttled).
- Mainnet additionally needs a real (non-placeholder) program keypair kept
  out of version control.

After deploying, register the program id (`ARCENPAY_CONTRACT_9100001_*`, see
the script output) and call `initialize_config(treasury, fee_bps)` once.

## Local validator smoke test

`scripts/localnet-smoke.ts` drives a real end-to-end flow against
`solana-test-validator`, using the **same** instruction encoders and event
decoders the facilitator uses (`apps/facilitator/src/services/solana-*.ts`):

initialize_config → create_plan → subscribe, then asserts the SPL balances
(fee split), decodes the on-chain `Subscription` account and the emitted
`SubscriptionMinted` / `BillingExecuted` events, and that a duplicate
`subscribe` is rejected.

```bash
solana-test-validator --reset &                  # background
solana program deploy target/deploy/arcenpay_solana.so

# NOTE: declare_id! must match the deploy keypair. Run `anchor keys sync`,
# or set declare_id! to `solana-keygen pubkey target/deploy/<name>-keypair.json`.
PROGRAM_ID=<deployed id> SOLANA_SCRATCH=<dir with id/provider/treasury/subscriber/mint keypairs> \
  npm run smoke:localnet
```

The smoke was run once against a local validator and all checks passed
(fee split 50 bps, decoded events + account, duplicate rejected).

After deployment, mirror the program id into the platform so the facilitator
and backend can find it — either:

- `packages/internal-core/src/addresses.ts` (`SOLANA_DEVNET_CHAIN_ID` /
  `SOLANA_MAINNET_CHAIN_ID` entries), or
- env: `ARCENPAY_CONTRACT_9100001_subscriptionRegistry=<programId>` (and the
  other keys).

Then start the facilitator with `CHAIN_ID=<solana synthetic id>` and
`ARCENPAY_SOLANA_RPC_URL_<id>=<rpc>`.
