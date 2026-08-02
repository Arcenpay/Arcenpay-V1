use soroban_sdk::{Address, BytesN, String, Vec};

pub const MONTHLY_INTERVAL: u64 = 2_592_000;
pub const YEARLY_INTERVAL: u64 = 31_536_000;
pub const MIN_BILLING_INTERVAL: u64 = 2_592_000;

pub const BPS_DENOMINATOR: u128 = 10_000;

pub const DEFAULT_SUBSCRIPTION_FEE_BPS: u128 = 50;
pub const DEFAULT_SETTLEMENT_FEE_BPS: u128 = 30;

pub const MAX_FEE_BPS: u128 = 1_000;

#[derive(Clone, Debug)]
#[soroban_sdk::contracttype]
pub struct PlanRecord {
    pub id: u128,
    pub provider: Address,
    pub name: String,
    pub tier: String,
    pub price: i128,
    pub billing_interval: u64,
    pub accepted_token: Address,
    pub active: bool,
    pub metadata_uri: String,
}

#[derive(Clone, Debug)]
#[soroban_sdk::contracttype]
pub struct AutopayConfigRecord {
    pub merchant: Address,
    pub max_amount: i128,
    pub token: Address,
    pub interval: u64,
    pub start_time: u64,
    pub plan_id: u128,
    pub max_total_amount: i128,
}

#[derive(Clone, Debug)]
#[soroban_sdk::contracttype]
pub struct SubscriptionRecord {
    pub token_id: u128,
    pub owner: Address,
    pub plan_id: u128,
    pub plan_tier: String,
    pub expiration: u64,
    pub active: bool,
    pub minted_at: u64,
    pub last_renewed_at: u64,
    pub total_paid: i128,
}

#[derive(Clone, Debug)]
#[soroban_sdk::contracttype]
pub struct SessionRecord {
    pub session_id: BytesN<32>,
    pub agent: Address,
    pub token: Address,
    pub balance: i128,
    pub total_funded: i128,
    pub total_settled: i128,
    pub active: bool,
    pub created_at: u64,
}

#[derive(Clone, Debug)]
#[soroban_sdk::contracttype]
pub struct MirroredSubscriptionRecord {
    pub subscriber: Address,
    pub plan_id: u128,
    pub plan_tier: String,
    pub expiration: u64,
    pub source_chain_id: u64,
    pub source_token_id: u128,
    pub source_updated_at: u64,
    pub last_updated: u64,
}

#[derive(Clone, Debug)]
#[soroban_sdk::contracttype]
pub struct FlagEntryRecord {
    pub team_id: BytesN<32>,
    pub feature_key: String,
    pub default_value: bool,
    pub exists: bool,
    pub created_at: u64,
    pub updated_at: u64,
}

#[derive(Clone, Debug)]
#[soroban_sdk::contracttype]
pub struct ProofRecord {
    pub a: (BytesN<32>, BytesN<32>),
    pub b: ((BytesN<32>, BytesN<32>), (BytesN<32>, BytesN<32>)),
    pub c: (BytesN<32>, BytesN<32>),
}

#[derive(Clone, Debug)]
#[soroban_sdk::contracttype]
pub struct RateScheduleRecord {
    pub plan_id: u128,
    pub rate_per_call: i128,
}

#[derive(Clone)]
#[soroban_sdk::contracttype]
pub enum SubscriptionStatus {
    Active,
    PastDue,
    Cancelled,
    Expired,
}

#[derive(Clone)]
#[soroban_sdk::contracttype]
pub enum ChangeType {
    Upgrade,
    Downgrade,
    Cancellation,
    Resume,
    BillingPeriodChange,
}

#[derive(Clone)]
#[soroban_sdk::contracttype]
pub enum TierLevel {
    Free,
    Plus,
    Pro,
}
