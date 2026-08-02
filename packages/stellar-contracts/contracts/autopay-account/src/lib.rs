#![no_std]

use soroban_sdk::{contract, contractimpl, contracttype, Address, Env, String, Vec, xdr::FromXdr, xdr::ToXdr};
use arcenpay_common::{
    auth::*,
    errors::ArcenPayError,
    types::*,
    token::{sac_transfer, sac_balance},
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
    env.storage().persistent().set(&DataKey::AutopayConfig(account.clone()), config);
}

fn is_initialized(env: &Env, account: &Address) -> bool {
    env.storage().persistent().has(&DataKey::AutopayConfig(account.clone()))
}

fn last_pull_time(env: &Env, account: &Address) -> u64 {
    env.storage()
        .persistent()
        .get(&DataKey::LastPullTime(account.clone()))
        .unwrap_or(0)
}

fn set_last_pull_time(env: &Env, account: &Address, time: u64) {
    env.storage().persistent().set(&DataKey::LastPullTime(account.clone()), &time);
}

fn has_pulled(env: &Env, account: &Address) -> bool {
    env.storage()
        .persistent()
        .get(&DataKey::HasPulled(account.clone()))
        .unwrap_or(false)
}

fn set_has_pulled(env: &Env, account: &Address) {
    env.storage().persistent().set(&DataKey::HasPulled(account.clone()), &true);
}

fn total_pulled(env: &Env, account: &Address) -> i128 {
    env.storage()
        .persistent()
        .get(&DataKey::TotalPulled(account.clone()))
        .unwrap_or(0)
}

fn add_total_pulled(env: &Env, account: &Address, amount: i128) {
    let current = total_pulled(env, account);
    env.storage().persistent().set(&DataKey::TotalPulled(account.clone()), &(current + amount));
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

fn read_plan_factory(env: &Env) -> Address {
    env.storage()
        .instance()
        .get(&DataKey::PlanFactoryAddr)
        .expect("PlanFactory not configured")
}

fn validate_config(config: &AutopayConfigRecord) {
    assert!(config.max_amount > 0, "maxAmount must be positive");
    assert!(config.merchant != Address::from_string(&soroban_sdk::String::from_slice(&soroban_sdk::Env::default(), "")), "Invalid merchant");
    assert!(config.interval >= MIN_BILLING_INTERVAL, "Interval too short");
    if config.max_total_amount > 0 {
        assert!(config.max_total_amount >= config.max_amount, "maxTotalAmount < maxAmount");
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
        assert!(!read_initialized(&env), "Already initialized");
        write_admin(&env, &admin);
        env.storage().instance().set(&DataKey::OperatorAdmin, &operator_admin);
        env.storage().instance().set(&DataKey::PlanFactoryAddr, &plan_factory);
        env.storage().instance().set(&DataKey::SubscriptionRegistryAddr, &subscription_registry);
        env.storage().instance().set(&DataKey::FeeCollectorAddr, &fee_collector);
        env.storage().instance().set(&DataKey::MigrationEnabled, &true);
        write_initialized(&env);
    }

    pub fn version() -> u32 { 1 }

    pub fn admin(env: Env) -> Address {
        read_admin(&env)
    }

    pub fn transfer_admin(env: Env, new_admin: Address) {
        let current = read_admin(&env);
        current.require_auth();
        assert_ne!(new_admin, current);
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
        assert_eq!(admin, stored);
        admin.require_auth();
        env.storage().instance().set(&DataKey::OperatorAdmin, &new_admin);
        AdminUpdated { previous_admin: admin, new_admin }.publish(&env);
    }

    pub fn pause(env: Env, caller: Address) {
        let op_admin: Address = env.storage().instance().get(&DataKey::OperatorAdmin).unwrap();
        assert_eq!(caller, op_admin, "Not operator admin");
        caller.require_auth();
        write_paused(&env, true);
    }

    pub fn unpause(env: Env, caller: Address) {
        let op_admin: Address = env.storage().instance().get(&DataKey::OperatorAdmin).unwrap();
        assert_eq!(caller, op_admin, "Not operator admin");
        caller.require_auth();
        write_paused(&env, false);
    }

    pub fn configure(
        env: Env,
        account: Address,
        config: AutopayConfigRecord,
    ) {
        account.require_auth();
        require_not_paused(&env);
        validate_config(&config);

        assert!(!is_initialized(&env, &account), "Already initialized — use update_config");

        write_config(&env, &account, &config);
        env.storage().persistent().set(&DataKey::TotalPulled(account.clone()), &0i128);

        AutopayConfigured {
            account,
            merchant: config.merchant,
            max_amount: config.max_amount,
            token: config.token,
            interval: config.interval,
        }.publish(&env);
    }

    pub fn update_config(
        env: Env,
        account: Address,
        config: AutopayConfigRecord,
    ) {
        account.require_auth();
        require_not_paused(&env);
        assert!(is_initialized(&env, &account), "Not initialized");

        let existing = read_config(&env, &account);
        let previous_plan_id = existing.plan_id;
        validate_config(&config);

        write_config(&env, &account, &config);

        AutopayConfigUpdated {
            account: account.clone(),
            previous_plan_id,
            new_plan_id: config.plan_id,
            max_amount: config.max_amount,
            interval: config.interval,
        }.publish(&env);
    }

    pub fn revoke(env: Env, account: Address) {
        account.require_auth();
        require_not_paused(&env);
        assert!(is_initialized(&env, &account), "Not initialized");

        env.storage().persistent().remove(&DataKey::AutopayConfig(account.clone()));
        env.storage().persistent().remove(&DataKey::LastPullTime(account.clone()));
        env.storage().persistent().remove(&DataKey::HasPulled(account.clone()));
        env.storage().persistent().remove(&DataKey::TotalPulled(account.clone()));
        env.storage().persistent().remove(&DataKey::AccountPaused(account.clone()));

        AutopayRevoked { account }.publish(&env);
    }

    pub fn set_mirror_destination(env: Env, account: Address, chain_id: u64) {
        account.require_auth();
        assert!(is_initialized(&env, &account), "Not initialized");
        env.storage().persistent().set(&DataKey::MirrorDestinationChainId(account.clone()), &chain_id);
    }

    pub fn get_config(env: Env, account: Address) -> AutopayConfigRecord {
        read_config(&env, &account)
    }

    pub fn is_initialized(env: Env, account: Address) -> bool {
        is_initialized(&env, &account)
    }

    pub fn pause_account(env: Env, account: Address) {
        account.require_auth();
        assert!(is_initialized(&env, &account), "Not initialized");
        env.storage().persistent().set(&DataKey::AccountPaused(account.clone()), &true);
        AccountAutopayPaused { account }.publish(&env);
    }

    pub fn unpause_account(env: Env, account: Address) {
        account.require_auth();
        assert!(is_initialized(&env, &account), "Not initialized");
        env.storage().persistent().set(&DataKey::AccountPaused(account.clone()), &false);
        AccountAutopayUnpaused { account }.publish(&env);
    }

    pub fn is_account_paused(env: Env, account: Address) -> bool {
        is_account_paused(&env, &account)
    }

    pub fn execute(
        env: Env,
        caller: Address,
        account: Address,
        amount: i128,
    ) {
        caller.require_auth();
        require_not_paused(&env);

        assert!(is_initialized(&env, &account), "Autopay not configured");
        assert!(!is_account_paused(&env, &account), "Account autopay paused");

        let config = read_config(&env, &account);
        assert!(amount > 0, "Amount must be positive");
        assert!(amount <= config.max_amount, "Amount exceeds maxAmount");

        let now = env.ledger().timestamp();
        if !has_pulled(&env, &account) {
            assert!(now >= config.start_time, "Billing start time not reached");
            set_has_pulled(&env, &account);
        } else {
            let last = last_pull_time(&env, &account);
            assert!(
                now >= last + config.interval,
                "Billing interval not elapsed"
            );
        }

        if config.max_total_amount > 0 {
            let current_total = total_pulled(&env, &account);
            assert!(
                current_total + amount <= config.max_total_amount,
                "Lifetime pull cap exceeded"
            );
        }

        set_last_pull_time(&env, &account, now);
        add_total_pulled(&env, &account, amount);

        let fee_collector = read_fee_collector(&env);
        let subscription_registry = read_subscription_registry(&env);

        let fee: i128 = env
            .invoke_contract(
                &fee_collector,
                &soroban_sdk::Symbol::new(&env, "collect_subscription_fee_for"),
                Vec::from_array(&env, [amount.into_val(&env), config.merchant.clone().into_val(&env)]),
            )
            .try_into_val(&env)
            .unwrap_or(0i128);

        let merchant_amount = amount - fee;

        let contract_addr = env.current_contract_address();
        sac_transfer(&env, &config.token, &account, &config.merchant, merchant_amount);
        sac_transfer(&env, &config.token, &account, &fee_collector, fee);

        let _ = env.invoke_contract(
            &fee_collector,
            &soroban_sdk::Symbol::new(&env, "receive_fee"),
            Vec::from_array(&env, [config.token.into_val(&env), fee.into_val(&env)]),
        );

        let reason: u32 = if has_pulled(&env, &account) && total_pulled(&env, &account) == amount {
            0
        } else {
            1
        };

        let token_id: u128 = env
            .invoke_contract(
                &subscription_registry,
                &soroban_sdk::Symbol::new(&env, "mint"),
                Vec::from_array(&env, [
                    contract_addr.clone().into_val(&env),
                    account.clone().into_val(&env),
                    config.plan_id.into_val(&env),
                    config.interval.into_val(&env),
                ]),
            )
            .try_into_val(&env)
            .unwrap_or(0);

        PaymentExecuted { account: account.clone(), merchant: config.merchant.clone(), amount, timestamp: now }.publish(&env);

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
        }.publish(&env);

        let mirror_chain: u64 = env
            .storage()
            .persistent()
            .get(&DataKey::MirrorDestinationChainId(account.clone()))
            .unwrap_or(0);

        if mirror_chain > 0 {
            let _ = env.invoke_contract(
                &subscription_registry,
                &soroban_sdk::Symbol::new(&env, "dispatch_cross_chain_update"),
                Vec::from_array(&env, [contract_addr.into_val(&env), token_id.into_val(&env), mirror_chain.into_val(&env)]),
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
        assert_eq!(admin, stored);
        admin.require_auth();
        require_not_paused(&env);
        assert!(migration_enabled(&env), "Migration not enabled");
        assert!(!is_initialized(&env, &account), "Account already initialized");

        validate_config(&config);
        write_config(&env, &account, &config);
        set_last_pull_time(&env, &account, last_pull_time_val);
        env.storage().persistent().set(&DataKey::TotalPulled(account.clone()), &total_pulled_val);
        env.storage().persistent().set(&DataKey::MirrorDestinationChainId(account.clone()), &mirror_destination);
        env.storage().persistent().set(&DataKey::AccountPaused(account.clone()), &account_paused);

        if last_pull_time_val > 0 {
            set_has_pulled(&env, &account);
        }

        AccountStateImported { account, plan_id: config.plan_id }.publish(&env);
    }

    pub fn finalize_migration(env: Env, admin: Address) {
        let stored = read_admin(&env);
        assert_eq!(admin, stored);
        admin.require_auth();
        assert!(migration_enabled(&env), "Migration already finalized");
        env.storage().instance().set(&DataKey::MigrationEnabled, &false);
        MigrationFinalized {}.publish(&env);
    }
}
