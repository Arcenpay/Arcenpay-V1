#![no_std]
#![allow(clippy::too_many_arguments)]

extern crate alloc;

use arcenpay_common::{
    auth::*,
    errors::{ArcenPayError, fail},
    token::sac_transfer,
    types::*,
};
use soroban_sdk::{Address, Env, String, contract, contractevent, contractimpl, contracttype};

#[contracttype]
enum DataKey {
    Admin,
    Paused,
    Treasury,
    AccumulatedFees(Address),
    AuthorizedCollector(Address),
    ProviderSubFeeOverride(Address),
    ProviderSettleFeeOverride(Address),
    TierSubFeeBps(u32),
    TierSettleFeeBps(u32),
}

#[contractevent]
pub struct FeeCollected {
    #[topic]
    pub from: Address,
    pub gross_amount: i128,
    pub fee_amount: i128,
    pub fee_type: String,
}

#[contractevent]
pub struct FeesWithdrawn {
    pub treasury: Address,
    pub token: Address,
    pub amount: i128,
}

#[contractevent]
pub struct ProviderFeeRateSet {
    #[topic]
    pub provider: Address,
    pub sub_fee_bps: u128,
    pub settle_fee_bps: u128,
}

#[contractevent]
pub struct ProviderTierSynced {
    #[topic]
    pub provider: Address,
    pub tier: u32,
    pub sub_fee_bps: u128,
    pub settle_fee_bps: u128,
}

#[contractevent]
pub struct TierFeeRatesSet {
    pub tier: u32,
    pub sub_fee_bps: u128,
    pub settle_fee_bps: u128,
}

#[contractevent]
pub struct TreasuryUpdated {
    pub new_treasury: Address,
}

#[contractevent]
pub struct CollectorAuthorized {
    pub collector: Address,
}

#[contractevent]
pub struct CollectorRevoked {
    pub collector: Address,
}

fn compute_fee(amount: i128, fee_bps: u128) -> i128 {
    if fee_bps == 0 || amount <= 0 {
        return 0;
    }
    let amount_u: u128 = amount as u128;
    let fee = (amount_u * fee_bps) / BPS_DENOMINATOR;
    fee as i128
}

fn read_treasury(env: &Env) -> Address {
    env.storage()
        .instance()
        .get(&DataKey::Treasury)
        .unwrap_or_else(|| fail(env, ArcenPayError::NotInitialized))
}

fn is_collector(env: &Env, collector: &Address) -> bool {
    env.storage()
        .persistent()
        .get(&DataKey::AuthorizedCollector(collector.clone()))
        .unwrap_or(false)
}

fn require_collector(env: &Env, caller: &Address) {
    if !is_collector(env, caller) {
        fail(env, ArcenPayError::NotAuthorized);
    }
}

fn get_provider_sub_fee(env: &Env, provider: &Address) -> u128 {
    let override_val: u128 = env
        .storage()
        .persistent()
        .get(&DataKey::ProviderSubFeeOverride(provider.clone()))
        .unwrap_or(0);
    if override_val > 0 {
        return override_val;
    }
    DEFAULT_SUBSCRIPTION_FEE_BPS
}

fn get_provider_settle_fee(env: &Env, provider: &Address) -> u128 {
    let override_val: u128 = env
        .storage()
        .persistent()
        .get(&DataKey::ProviderSettleFeeOverride(provider.clone()))
        .unwrap_or(0);
    if override_val > 0 {
        return override_val;
    }
    DEFAULT_SETTLEMENT_FEE_BPS
}

fn tier_level(env: &Env, tier: u32) -> (u128, u128) {
    let sub = env
        .storage()
        .instance()
        .get(&DataKey::TierSubFeeBps(tier))
        .unwrap_or(DEFAULT_SUBSCRIPTION_FEE_BPS);
    let settle = env
        .storage()
        .instance()
        .get(&DataKey::TierSettleFeeBps(tier))
        .unwrap_or(DEFAULT_SETTLEMENT_FEE_BPS);
    (sub, settle)
}

#[contract]
pub struct FeeCollector;

#[contractimpl]
impl FeeCollector {
    pub fn __constructor(env: Env, admin: Address, treasury: Address) {
        if read_initialized(&env) {
            fail(&env, ArcenPayError::AlreadyInitialized);
        }
        write_admin(&env, &admin);
        env.storage().instance().set(&DataKey::Treasury, &treasury);

        env.storage()
            .instance()
            .set(&DataKey::TierSubFeeBps(0), &200u128);
        env.storage()
            .instance()
            .set(&DataKey::TierSettleFeeBps(0), &100u128);
        env.storage()
            .instance()
            .set(&DataKey::TierSubFeeBps(1), &100u128);
        env.storage()
            .instance()
            .set(&DataKey::TierSettleFeeBps(1), &50u128);
        env.storage()
            .instance()
            .set(&DataKey::TierSubFeeBps(2), &50u128);
        env.storage()
            .instance()
            .set(&DataKey::TierSettleFeeBps(2), &30u128);

        write_initialized(&env);
    }

    pub fn version() -> u32 {
        1
    }

    pub fn admin(env: Env) -> Address {
        read_admin(&env)
    }

    pub fn transfer_admin(env: Env, new_admin: Address) {
        let current = read_admin(&env);
        current.require_auth();
        if new_admin == current {
            fail(&env, ArcenPayError::InvalidAddress);
        }
        write_admin(&env, &new_admin);
    }

    pub fn treasury(env: Env) -> Address {
        read_treasury(&env)
    }

    pub fn set_treasury(env: Env, admin: Address, new_treasury: Address) {
        let stored = read_admin(&env);
        if admin != stored {
            fail(&env, ArcenPayError::NotAuthorized);
        }
        admin.require_auth();
        env.storage()
            .instance()
            .set(&DataKey::Treasury, &new_treasury);
        TreasuryUpdated { new_treasury }.publish(&env);
    }

    pub fn authorize_collector(env: Env, admin: Address, collector: Address) {
        let stored = read_admin(&env);
        if admin != stored {
            fail(&env, ArcenPayError::NotAuthorized);
        }
        admin.require_auth();
        env.storage()
            .persistent()
            .set(&DataKey::AuthorizedCollector(collector.clone()), &true);
        CollectorAuthorized { collector }.publish(&env);
    }

    pub fn revoke_collector(env: Env, admin: Address, collector: Address) {
        let stored = read_admin(&env);
        if admin != stored {
            fail(&env, ArcenPayError::NotAuthorized);
        }
        admin.require_auth();
        env.storage()
            .persistent()
            .set(&DataKey::AuthorizedCollector(collector.clone()), &false);
        CollectorRevoked { collector }.publish(&env);
    }

    pub fn is_collector(env: Env, collector: Address) -> bool {
        is_collector(&env, &collector)
    }

    pub fn set_provider_fee_rates(
        env: Env,
        admin: Address,
        provider: Address,
        sub_fee_bps: u128,
        settle_fee_bps: u128,
    ) {
        let stored = read_admin(&env);
        if admin != stored {
            fail(&env, ArcenPayError::NotAuthorized);
        }
        admin.require_auth();
        if sub_fee_bps > MAX_FEE_BPS {
            fail(&env, ArcenPayError::FeeRateTooHigh);
        }
        if settle_fee_bps > MAX_FEE_BPS {
            fail(&env, ArcenPayError::FeeRateTooHigh);
        }

        env.storage().persistent().set(
            &DataKey::ProviderSubFeeOverride(provider.clone()),
            &sub_fee_bps,
        );
        env.storage().persistent().set(
            &DataKey::ProviderSettleFeeOverride(provider.clone()),
            &settle_fee_bps,
        );

        ProviderFeeRateSet {
            provider,
            sub_fee_bps,
            settle_fee_bps,
        }
        .publish(&env);
    }

    pub fn sync_provider_tier(env: Env, admin: Address, provider: Address, tier: u32) {
        let stored = read_admin(&env);
        if admin != stored {
            fail(&env, ArcenPayError::NotAuthorized);
        }
        admin.require_auth();
        if tier > 2 {
            fail(&env, ArcenPayError::InvalidTier);
        }

        let (sub, settle) = tier_level(&env, tier);

        env.storage()
            .persistent()
            .set(&DataKey::ProviderSubFeeOverride(provider.clone()), &sub);
        env.storage().persistent().set(
            &DataKey::ProviderSettleFeeOverride(provider.clone()),
            &settle,
        );

        ProviderTierSynced {
            provider,
            tier,
            sub_fee_bps: sub,
            settle_fee_bps: settle,
        }
        .publish(&env);
    }

    pub fn set_tier_fee_rates(
        env: Env,
        admin: Address,
        tier: u32,
        sub_fee_bps: u128,
        settle_fee_bps: u128,
    ) {
        let stored = read_admin(&env);
        if admin != stored {
            fail(&env, ArcenPayError::NotAuthorized);
        }
        admin.require_auth();
        if tier > 2 {
            fail(&env, ArcenPayError::InvalidTier);
        }
        if sub_fee_bps > MAX_FEE_BPS {
            fail(&env, ArcenPayError::FeeRateTooHigh);
        }
        if settle_fee_bps > MAX_FEE_BPS {
            fail(&env, ArcenPayError::FeeRateTooHigh);
        }

        env.storage()
            .instance()
            .set(&DataKey::TierSubFeeBps(tier), &sub_fee_bps);
        env.storage()
            .instance()
            .set(&DataKey::TierSettleFeeBps(tier), &settle_fee_bps);

        TierFeeRatesSet {
            tier,
            sub_fee_bps,
            settle_fee_bps,
        }
        .publish(&env);
    }

    pub fn get_provider_sub_fee_bps(env: Env, provider: Address) -> u128 {
        get_provider_sub_fee(&env, &provider)
    }

    pub fn get_provider_settle_fee_bps(env: Env, provider: Address) -> u128 {
        get_provider_settle_fee(&env, &provider)
    }

    pub fn subscription_fee_rate() -> u128 {
        DEFAULT_SUBSCRIPTION_FEE_BPS
    }

    pub fn settlement_fee_rate() -> u128 {
        DEFAULT_SETTLEMENT_FEE_BPS
    }

    pub fn collect_subscription_fee(env: Env, caller: Address, amount: i128) -> i128 {
        caller.require_auth();
        require_collector(&env, &caller);
        let fee = compute_fee(amount, DEFAULT_SUBSCRIPTION_FEE_BPS);
        FeeCollected {
            from: caller.clone(),
            gross_amount: amount,
            fee_amount: fee,
            fee_type: String::from_str(&env, "subscription"),
        }
        .publish(&env);
        fee
    }

    pub fn collect_subscription_fee_for(
        env: Env,
        caller: Address,
        amount: i128,
        provider: Address,
    ) -> i128 {
        caller.require_auth();
        require_collector(&env, &caller);
        let fee_bps = get_provider_sub_fee(&env, &provider);
        let fee = compute_fee(amount, fee_bps);
        FeeCollected {
            from: caller,
            gross_amount: amount,
            fee_amount: fee,
            fee_type: String::from_str(&env, "subscription"),
        }
        .publish(&env);
        fee
    }

    pub fn collect_settlement_fee(env: Env, caller: Address, amount: i128) -> i128 {
        caller.require_auth();
        require_collector(&env, &caller);
        let fee = compute_fee(amount, DEFAULT_SETTLEMENT_FEE_BPS);
        FeeCollected {
            from: caller.clone(),
            gross_amount: amount,
            fee_amount: fee,
            fee_type: String::from_str(&env, "settlement"),
        }
        .publish(&env);
        fee
    }

    pub fn collect_settlement_fee_for(
        env: Env,
        caller: Address,
        amount: i128,
        provider: Address,
    ) -> i128 {
        caller.require_auth();
        require_collector(&env, &caller);
        let fee_bps = get_provider_settle_fee(&env, &provider);
        let fee = compute_fee(amount, fee_bps);
        FeeCollected {
            from: caller,
            gross_amount: amount,
            fee_amount: fee,
            fee_type: String::from_str(&env, "settlement"),
        }
        .publish(&env);
        fee
    }

    pub fn receive_fee(env: Env, caller: Address, token: Address, amount: i128) {
        caller.require_auth();
        require_collector(&env, &caller);
        let current: i128 = env
            .storage()
            .persistent()
            .get(&DataKey::AccumulatedFees(token.clone()))
            .unwrap_or(0);
        env.storage().persistent().set(
            &DataKey::AccumulatedFees(token.clone()),
            &(current + amount),
        );
    }

    pub fn accumulated_fees(env: Env, token: Address) -> i128 {
        env.storage()
            .persistent()
            .get(&DataKey::AccumulatedFees(token))
            .unwrap_or(0)
    }

    pub fn withdraw_fees(env: Env, admin: Address, token: Address) {
        let stored = read_admin(&env);
        if admin != stored {
            fail(&env, ArcenPayError::NotAuthorized);
        }
        admin.require_auth();

        let amount: i128 = env
            .storage()
            .persistent()
            .get(&DataKey::AccumulatedFees(token.clone()))
            .unwrap_or(0);
        if amount <= 0 {
            fail(&env, ArcenPayError::InvalidAmount);
        }

        env.storage()
            .persistent()
            .set(&DataKey::AccumulatedFees(token.clone()), &0i128);

        let treasury = read_treasury(&env);
        let contract = env.current_contract_address();
        sac_transfer(&env, &token, &contract, &treasury, amount);

        FeesWithdrawn {
            treasury,
            token,
            amount,
        }
        .publish(&env);
    }

    pub fn tier_fee_rates(env: Env, tier: u32) -> (u128, u128) {
        tier_level(&env, tier)
    }
}
