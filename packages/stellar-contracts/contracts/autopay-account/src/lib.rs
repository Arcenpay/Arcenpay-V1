#![no_std]
#![allow(clippy::too_many_arguments)]

extern crate alloc;

use arcenpay_common::{
    auth::*,
    errors::{ArcenPayError, fail},
    token::sac_transfer,
    types::*,
};
use soroban_sdk::{
    Address, Env, IntoVal, Vec, contract, contractevent, contractimpl, contracttype,
};

#[contracttype]
enum DataKey {
    Admin,
    OperatorAdmin,
    Paused,
    AutopayConfig(Address),
    LastPullTime(Address),
    HasPulled(Address),
    TotalPulled(Address),
    AccountPaused(Address),
    MirrorDestinationChainId(Address),
    MigrationEnabled,
    PlanFactoryAddr,
    SubscriptionRegistryAddr,
    FeeCollectorAddr,
}

#[contractevent]
pub struct AutopayConfigured {
    #[topic]
    pub account: Address,
    pub merchant: Address,
    pub max_amount: i128,
    pub token: Address,
    pub interval: u64,
}

#[contractevent]
pub struct AutopayConfigUpdated {
    #[topic]
    pub account: Address,
    pub previous_plan_id: u128,
    pub new_plan_id: u128,
    pub max_amount: i128,
    pub interval: u64,
}

#[contractevent]
pub struct PaymentExecuted {
    #[topic]
    pub account: Address,
    pub merchant: Address,
    pub amount: i128,
    pub timestamp: u64,
}

#[contractevent]
pub struct BillingExecuted {
    #[topic]
    pub account: Address,
    pub merchant: Address,
    pub token_id: u128,
    pub plan_id: u128,
    pub reason: u32,
    pub gross_amount: i128,
    pub merchant_amount: i128,
    pub protocol_fee: i128,
    pub timestamp: u64,
}

#[contractevent]
pub struct AutopayRevoked {
    #[topic]
    pub account: Address,
}

#[contractevent]
pub struct AccountAutopayPaused {
    #[topic]
    pub account: Address,
}

#[contractevent]
pub struct AccountAutopayUnpaused {
    #[topic]
    pub account: Address,
}

#[contractevent]
pub struct AdminUpdated {
    pub previous_admin: Address,
    pub new_admin: Address,
}

#[contractevent]
pub struct AccountStateImported {
    #[topic]
    pub account: Address,
    pub plan_id: u128,
}

#[contractevent]
pub struct MigrationFinalized {}

fn read_config(env: &Env, account: &Address) -> AutopayConfigRecord {
    env.storage()
        .persistent()
        .get(&DataKey::AutopayConfig(account.clone()))
        .expect("Autopay not configured for this account")
}

fn write_config(env: &Env, account: &Address, config: &AutopayConfigRecord) {
    env.storage()
        .persistent()
        .set(&DataKey::AutopayConfig(account.clone()), config);
}

fn is_initialized(env: &Env, account: &Address) -> bool {
    env.storage()
        .persistent()
        .has(&DataKey::AutopayConfig(account.clone()))
}

fn last_pull_time(env: &Env, account: &Address) -> u64 {
    env.storage()
        .persistent()
        .get(&DataKey::LastPullTime(account.clone()))
        .unwrap_or(0)
}

fn set_last_pull_time(env: &Env, account: &Address, time: u64) {
    env.storage()
        .persistent()
        .set(&DataKey::LastPullTime(account.clone()), &time);
}

fn has_pulled(env: &Env, account: &Address) -> bool {
    env.storage()
        .persistent()
        .get(&DataKey::HasPulled(account.clone()))
        .unwrap_or(false)
}

fn set_has_pulled(env: &Env, account: &Address) {
    env.storage()
        .persistent()
        .set(&DataKey::HasPulled(account.clone()), &true);
}

fn total_pulled(env: &Env, account: &Address) -> i128 {
    env.storage()
        .persistent()
        .get(&DataKey::TotalPulled(account.clone()))
        .unwrap_or(0)
}

fn add_total_pulled(env: &Env, account: &Address, amount: i128) {
    let current = total_pulled(env, account);
    env.storage()
        .persistent()
        .set(&DataKey::TotalPulled(account.clone()), &(current + amount));
}

fn is_account_paused(env: &Env, account: &Address) -> bool {
    env.storage()
        .persistent()
        .get(&DataKey::AccountPaused(account.clone()))
        .unwrap_or(false)
}

fn migration_enabled(env: &Env) -> bool {
    env.storage()
        .instance()
        .get(&DataKey::MigrationEnabled)
        .unwrap_or(true)
}

fn read_fee_collector(env: &Env) -> Address {
    env.storage()
        .instance()
        .get(&DataKey::FeeCollectorAddr)
        .expect("FeeCollector not configured")
}

fn read_subscription_registry(env: &Env) -> Address {
    env.storage()
        .instance()
        .get(&DataKey::SubscriptionRegistryAddr)
        .expect("SubscriptionRegistry not configured")
}

#[allow(dead_code)]
fn read_plan_factory(env: &Env) -> Address {
    env.storage()
        .instance()
        .get(&DataKey::PlanFactoryAddr)
        .expect("PlanFactory not configured")
}

fn validate_config(_env: &Env, config: &AutopayConfigRecord) {
    if config.max_amount <= 0 {
        fail(_env, ArcenPayError::InvalidAmount);
    }
    // A zero merchant address is an invalid configuration.
    if config.merchant == _env.current_contract_address() {
        // unlikely but ensure non-zero contract address is allowed too;
        // we cannot cheaply test for "zero address" on Soroban, so accept
        // any non-self address. Self-as-merchant is rejected.
        fail(_env, ArcenPayError::InvalidAddress);
    }
    if config.interval < MIN_BILLING_INTERVAL {
        fail(_env, ArcenPayError::InvalidInterval);
    }
    if config.max_total_amount > 0 && config.max_total_amount < config.max_amount {
        fail(_env, ArcenPayError::CapExceeded);
    }
}

#[contract]
pub struct AutopayAccount;

#[contractimpl]
impl AutopayAccount {
    pub fn __constructor(
        env: Env,
        admin: Address,
        operator_admin: Address,
        plan_factory: Address,
        subscription_registry: Address,
        fee_collector: Address,
    ) {
        if read_initialized(&env) {
            fail(&env, ArcenPayError::AlreadyInitialized);
        }
        write_admin(&env, &admin);
        env.storage()
            .instance()
            .set(&DataKey::OperatorAdmin, &operator_admin);
        env.storage()
            .instance()
            .set(&DataKey::PlanFactoryAddr, &plan_factory);
        env.storage()
            .instance()
            .set(&DataKey::SubscriptionRegistryAddr, &subscription_registry);
        env.storage()
            .instance()
            .set(&DataKey::FeeCollectorAddr, &fee_collector);
        env.storage()
            .instance()
            .set(&DataKey::MigrationEnabled, &true);
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
        if new_admin == current {
            fail(&env, ArcenPayError::InvalidAddress);
        }
        current.require_auth();
        write_admin(&env, &new_admin);
    }

    pub fn operator_admin(env: Env) -> Address {
        env.storage()
            .instance()
            .get(&DataKey::OperatorAdmin)
            .expect("Operator admin not set")
    }

    pub fn set_operator_admin(env: Env, admin: Address, new_admin: Address) {
        let stored = read_admin(&env);
        if admin != stored {
            fail(&env, ArcenPayError::NotAuthorized);
        }
        admin.require_auth();
        env.storage()
            .instance()
            .set(&DataKey::OperatorAdmin, &new_admin);
        AdminUpdated {
            previous_admin: admin,
            new_admin,
        }
        .publish(&env);
    }

    pub fn pause(env: Env, caller: Address) {
        let op_admin: Address = env
            .storage()
            .instance()
            .get(&DataKey::OperatorAdmin)
            .unwrap_or_else(|| fail(&env, ArcenPayError::NotInitialized));
        if caller != op_admin {
            fail(&env, ArcenPayError::NotAuthorized);
        }
        caller.require_auth();
        write_paused(&env, true);
    }

    pub fn unpause(env: Env, caller: Address) {
        let op_admin: Address = env
            .storage()
            .instance()
            .get(&DataKey::OperatorAdmin)
            .unwrap_or_else(|| fail(&env, ArcenPayError::NotInitialized));
        if caller != op_admin {
            fail(&env, ArcenPayError::NotAuthorized);
        }
        caller.require_auth();
        write_paused(&env, false);
    }

    pub fn configure(env: Env, account: Address, config: AutopayConfigRecord) {
        account.require_auth();
        require_not_paused(&env);
        validate_config(&env, &config);

        if is_initialized(&env, &account) {
            fail(&env, ArcenPayError::AlreadyExists);
        }

        write_config(&env, &account, &config);
        env.storage()
            .persistent()
            .set(&DataKey::TotalPulled(account.clone()), &0i128);

        AutopayConfigured {
            account,
            merchant: config.merchant,
            max_amount: config.max_amount,
            token: config.token,
            interval: config.interval,
        }
        .publish(&env);
    }

    pub fn update_config(env: Env, account: Address, config: AutopayConfigRecord) {
        account.require_auth();
        require_not_paused(&env);
        if !is_initialized(&env, &account) {
            fail(&env, ArcenPayError::NotFound);
        }

        let existing = read_config(&env, &account);
        let previous_plan_id = existing.plan_id;
        validate_config(&env, &config);

        // A new config defines a new lifetime budget window (matches EVM).
        env.storage()
            .persistent()
            .set(&DataKey::TotalPulled(account.clone()), &0i128);
        write_config(&env, &account, &config);

        AutopayConfigUpdated {
            account: account.clone(),
            previous_plan_id,
            new_plan_id: config.plan_id,
            max_amount: config.max_amount,
            interval: config.interval,
        }
        .publish(&env);
    }

    pub fn revoke(env: Env, account: Address) {
        account.require_auth();
        require_not_paused(&env);
        if !is_initialized(&env, &account) {
            fail(&env, ArcenPayError::NotFound);
        }

        env.storage()
            .persistent()
            .remove(&DataKey::AutopayConfig(account.clone()));
        env.storage()
            .persistent()
            .remove(&DataKey::LastPullTime(account.clone()));
        env.storage()
            .persistent()
            .remove(&DataKey::HasPulled(account.clone()));
        env.storage()
            .persistent()
            .remove(&DataKey::TotalPulled(account.clone()));
        env.storage()
            .persistent()
            .remove(&DataKey::AccountPaused(account.clone()));

        AutopayRevoked { account }.publish(&env);
    }

    pub fn set_mirror_destination(env: Env, account: Address, chain_id: u64) {
        account.require_auth();
        if !is_initialized(&env, &account) {
            fail(&env, ArcenPayError::NotFound);
        }
        env.storage().persistent().set(
            &DataKey::MirrorDestinationChainId(account.clone()),
            &chain_id,
        );
    }

    pub fn get_config(env: Env, account: Address) -> AutopayConfigRecord {
        if !is_initialized(&env, &account) {
            fail(&env, ArcenPayError::NotFound);
        }
        read_config(&env, &account)
    }

    pub fn is_initialized(env: Env, account: Address) -> bool {
        is_initialized(&env, &account)
    }

    pub fn pause_account(env: Env, account: Address) {
        account.require_auth();
        if !is_initialized(&env, &account) {
            fail(&env, ArcenPayError::NotFound);
        }
        env.storage()
            .persistent()
            .set(&DataKey::AccountPaused(account.clone()), &true);
        AccountAutopayPaused { account }.publish(&env);
    }

    pub fn unpause_account(env: Env, account: Address) {
        account.require_auth();
        if !is_initialized(&env, &account) {
            fail(&env, ArcenPayError::NotFound);
        }
        env.storage()
            .persistent()
            .set(&DataKey::AccountPaused(account.clone()), &false);
        AccountAutopayUnpaused { account }.publish(&env);
    }

    pub fn is_account_paused(env: Env, account: Address) -> bool {
        is_account_paused(&env, &account)
    }

    pub fn execute(env: Env, caller: Address, account: Address, amount: i128) {
        caller.require_auth();
        require_not_paused(&env);

        if !is_initialized(&env, &account) {
            fail(&env, ArcenPayError::NotFound);
        }
        if is_account_paused(&env, &account) {
            fail(&env, ArcenPayError::AccountPaused);
        }

        let config = read_config(&env, &account);
        if amount <= 0 {
            fail(&env, ArcenPayError::InvalidAmount);
        }
        if amount > config.max_amount {
            fail(&env, ArcenPayError::CapExceeded);
        }

        let now = env.ledger().timestamp();
        let first_pull = !has_pulled(&env, &account);
        if first_pull {
            if now < config.start_time {
                fail(&env, ArcenPayError::IntervalNotElapsed);
            }
        } else {
            let last = last_pull_time(&env, &account);
            if now < last + config.interval {
                fail(&env, ArcenPayError::IntervalNotElapsed);
            }
        }

        if config.max_total_amount > 0 {
            let current_total = total_pulled(&env, &account);
            if current_total + amount > config.max_total_amount {
                fail(&env, ArcenPayError::CapExceeded);
            }
        }

        // Effects-before-interactions: persist pull time and total before any
        // external token / contract calls.
        set_last_pull_time(&env, &account, now);
        if first_pull {
            set_has_pulled(&env, &account);
        }
        add_total_pulled(&env, &account, amount);

        let fee_collector = read_fee_collector(&env);
        let subscription_registry = read_subscription_registry(&env);
        let contract_addr = env.current_contract_address();

        // FeeCollector.collect_subscription_fee_for(caller, amount, provider).
        // We pass our own address as the authorized collector "caller".
        let fee: i128 = env.invoke_contract(
            &fee_collector,
            &soroban_sdk::Symbol::new(&env, "collect_subscription_fee_for"),
            Vec::from_array(
                &env,
                [
                    contract_addr.clone().into_val(&env),
                    amount.into_val(&env),
                    config.merchant.clone().into_val(&env),
                ],
            ),
        );

        let merchant_amount = amount - fee;

        sac_transfer(
            &env,
            &config.token,
            &account,
            &config.merchant,
            merchant_amount,
        );
        if fee > 0 {
            sac_transfer(&env, &config.token, &account, &fee_collector, fee);
            // FeeCollector.receive_fee(caller, token, amount).
            let _: () = env.invoke_contract(
                &fee_collector,
                &soroban_sdk::Symbol::new(&env, "receive_fee"),
                Vec::from_array(
                    &env,
                    [
                        contract_addr.clone().into_val(&env),
                        config.token.clone().into_val(&env),
                        fee.into_val(&env),
                    ],
                ),
            );
        }

        // SubscriptionRegistry.mint(biller, to, plan_id, duration, amount_paid).
        // We pass amount so the registry can accumulate `total_paid`.
        let token_id: u128 = env.invoke_contract(
            &subscription_registry,
            &soroban_sdk::Symbol::new(&env, "mint"),
            Vec::from_array(
                &env,
                [
                    contract_addr.clone().into_val(&env),
                    account.clone().into_val(&env),
                    config.plan_id.into_val(&env),
                    config.interval.into_val(&env),
                    amount.into_val(&env),
                ],
            ),
        );

        // First pull mints a new subscription token (Activation), subsequent
        // pulls renew the existing token (Renewal). Matches EVM
        // `_getOrMintToken` activation-vs-renewal distinction.
        let reason: u32 = if first_pull { 0 } else { 1 };

        PaymentExecuted {
            account: account.clone(),
            merchant: config.merchant.clone(),
            amount,
            timestamp: now,
        }
        .publish(&env);

        BillingExecuted {
            account: account.clone(),
            merchant: config.merchant.clone(),
            token_id,
            plan_id: config.plan_id,
            reason,
            gross_amount: amount,
            merchant_amount,
            protocol_fee: fee,
            timestamp: now,
        }
        .publish(&env);

        let mirror_chain: u64 = env
            .storage()
            .persistent()
            .get(&DataKey::MirrorDestinationChainId(account.clone()))
            .unwrap_or(0);

        if mirror_chain > 0 {
            // SubscriptionRegistry.dispatch_cross_chain_update(biller, token_id, dest).
            let _: () = env.invoke_contract(
                &subscription_registry,
                &soroban_sdk::Symbol::new(&env, "dispatch_cross_chain_update"),
                Vec::from_array(
                    &env,
                    [
                        contract_addr.into_val(&env),
                        token_id.into_val(&env),
                        mirror_chain.into_val(&env),
                    ],
                ),
            );
        }
    }

    pub fn import_account_state(
        env: Env,
        admin: Address,
        account: Address,
        config: AutopayConfigRecord,
        last_pull_time_val: u64,
        total_pulled_val: i128,
        mirror_destination: u64,
        account_paused: bool,
    ) {
        let stored = read_admin(&env);
        if admin != stored {
            fail(&env, ArcenPayError::NotAuthorized);
        }
        admin.require_auth();
        require_not_paused(&env);
        if !migration_enabled(&env) {
            fail(&env, ArcenPayError::MigrationNotEnabled);
        }
        if is_initialized(&env, &account) {
            fail(&env, ArcenPayError::AlreadyExists);
        }

        validate_config(&env, &config);
        if last_pull_time_val > env.ledger().timestamp() {
            fail(&env, ArcenPayError::StaleUpdate);
        }
        if config.max_total_amount > 0 && total_pulled_val > config.max_total_amount {
            fail(&env, ArcenPayError::CapExceeded);
        }

        write_config(&env, &account, &config);
        set_last_pull_time(&env, &account, last_pull_time_val);
        env.storage()
            .persistent()
            .set(&DataKey::TotalPulled(account.clone()), &total_pulled_val);
        env.storage().persistent().set(
            &DataKey::MirrorDestinationChainId(account.clone()),
            &mirror_destination,
        );
        env.storage()
            .persistent()
            .set(&DataKey::AccountPaused(account.clone()), &account_paused);

        if last_pull_time_val > 0 {
            set_has_pulled(&env, &account);
        }

        AccountStateImported {
            account,
            plan_id: config.plan_id,
        }
        .publish(&env);
    }

    pub fn finalize_migration(env: Env, admin: Address) {
        let stored = read_admin(&env);
        if admin != stored {
            fail(&env, ArcenPayError::NotAuthorized);
        }
        admin.require_auth();
        if !migration_enabled(&env) {
            fail(&env, ArcenPayError::MigrationFinalized);
        }
        env.storage()
            .instance()
            .set(&DataKey::MigrationEnabled, &false);
        MigrationFinalized {}.publish(&env);
    }
}

#[cfg(test)]
mod tests;
