// ============================================================
//  ArcenPay Internal Core — Protocol Constants
// ============================================================

/** Subscription protocol fee: 0.5% (50 basis points) */
export const SUBSCRIPTION_FEE_BPS = 50n;

/** ZKVUB settlement fee: 0.3% (30 basis points) */
export const SETTLEMENT_FEE_BPS = 30n;

/** Basis points denominator */
export const BPS_DENOMINATOR = 10_000n;

/** Minimum billing interval: 30 days in seconds */
export const MIN_BILLING_INTERVAL = 2_592_000;

/** Monthly billing interval in seconds */
export const MONTHLY_INTERVAL = 2_592_000;

/** Yearly billing interval in seconds */
export const YEARLY_INTERVAL = 31_536_000;

/** ERC-7579 module type IDs */
export const MODULE_TYPES = {
  VALIDATOR: 1,
  EXECUTOR: 2,
  FALLBACK: 3,
  HOOK: 4,
} as const;

/** x402 protocol version */
export const X402_VERSION = '1';

/** x402 payment scheme */
export const X402_SCHEME = 'exact';

/** Locked interface version set for GA coordination */
export const INTERFACE_VERSIONS = {
  contractsAbi: 'v1',
  facilitatorApi: 'v1',
  dashboardApi: 'v1',
  sdkCore: 'v1',
  sdkReact: 'v1',
  sdkNode: 'v1',
} as const;
