// ============================================================
//  Backend re-export — Solana / Anchor instruction + account codec
//
//  The codec lives in `@arcenpay/internal-core/solana` (single source of
//  truth shared with the facilitator and SDKs). Kept as a facade so existing
//  backend imports don't churn.
// ============================================================

export * from "@arcenpay/internal-core/solana";
