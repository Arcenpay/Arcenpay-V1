#![no_std]

use soroban_sdk::{contract, contractimpl, contracttype, Address, Env, String, Vec, BytesN, xdr::FromXdr, xdr::ToXdr};
use arcenpay_common::{
    auth::*,
    errors::ArcenPayError,
    types::*,
};

#[contracttype]
enum DataKey {
    Admin,
    Paused,
    NextTokenId,
    SubscriptionByToken(u128),
    SubscriptionByWallet(Address),
    PlanFactoryAddr,
    AuthorizedBiller(Address),
    AuthorizedBridge(Address),
    AxelarTransport,
    CcipTransport,
    MigrationEnabled,
}

#[contractevent]
pub struct SubscriptionMinted {
    #[topic]
    pub subscriber: Address,
    pub token_id: u128,
    pub plan_id: u128,
    pub expiration: u64,
}

#[contractevent]
pub struct SubscriptionRenewed {
    #[topic]
    pub token_id: u128,
    pub new_expiration: u64,
    pub amount_paid: i128,
}

#[contractevent]
pub struct SubscriptionCancelled {
    #[topic]
    pub token_id: u128,
}

#[contractevent]
pub struct SubscriptionPlanChanged {
    #[topic]
    pub token_id: u128,
    pub previous_plan_id: u128,
    pub new_plan_id: u128,
    pub expiration: u64,
}

#[contractevent]
pub struct CrossChainDispatchRequested {
    #[topic]
    pub token_id: u128,
    pub destination_chain_id: u64,
    pub route: u32,
    pub payload_hash: BytesN<32>,
}

#[contractevent]
pub struct CrossChainFallbackTriggered {
    #[topic]
    pub token_id: u128,
    pub destination_chain_id: u64,
}

#[contractevent]
pub struct SubscriptionImported {
    #[topic]
    pub subscriber: Address,
    pub token_id: u128,
    pub plan_id: u128,
    pub expiration: u64,
}

#[contractevent]
pub struct RegistryMigrationFinalized {}

#[contractevent]
pub struct SubscriptionUpdate {
    #[topic]
    pub token_id: u128,
    pub expiration: u64,
}

#[contractevent]
pub struct BillerAuthorized {
    pub biller: Address,
}

#[contractevent]
pub struct BillerRevoked {
    pub biller: Address,
}

#[contractevent]
pub struct BridgeAuthorized {
    pub bridge: Address,
}

#[contractevent]
pub struct BridgeRevoked {
    pub bridge: Address,
}

fn read_subscription(env: &Env, token_id: u128) -> SubscriptionRecord {
    env.storage()
        .persistent()
        .get(&DataKey::SubscriptionByToken(token_id))
        .expect("Subscription not found")
}

fn write_subscription(env: &Env, token_id: u128, sub: &SubscriptionRecord) {
    env.storage().persistent().set(&DataKey::SubscriptionByToken(token_id), sub);
    env.storage().persistent().set(&DataKey::SubscriptionByWallet(sub.owner.clone()), &token_id);
}

fn read_plan_factory_addr(env: &Env) -> Address {
    env.storage()
        .instance()
        .get(&DataKey::PlanFactoryAddr)
        .expect("PlanFactory not configured")
}

fn is_biller(env: &Env, biller: &Address) -> bool {
    env.storage()
        .persistent()
        .get(&DataKey::AuthorizedBiller(biller.clone()))
        .unwrap_or(false)
}

fn require_biller(env: &Env, caller: &Address) {
    assert!(is_biller(env, caller), "Not an authorized biller");
}

fn is_bridge(env: &Env, bridge: &Address) -> bool {
    env.storage()
        .persistent()
        .get(&DataKey::AuthorizedBridge(bridge.clone()))
        .unwrap_or(false)
}

fn require_bridge(env: &Env, caller: &Address) {
    assert!(is_bridge(env, caller), "Not an authorized bridge");
}

fn migration_enabled(env: &Env) -> bool {
    env.storage()
        .instance()
        .get(&DataKey::MigrationEnabled)
        .unwrap_or(true)
}

fn increment_token_id(env: &Env) -> u128 {
    let id: u128 = env.storage().instance().get(&DataKey::NextTokenId).unwrap_or(1);
    env.storage().instance().set(&DataKey::NextTokenId, &(id + 1));
    id
}

fn build_mirror_payload(env: &Env, sub: &SubscriptionRecord) -> Vec<u8> {
    let mut payload = Vec::new(env);
    payload.append(&sub.owner.to_xdr(env));
    payload.append(&sub.token_id.to_xdr(env));
    payload.append(&sub.plan_id.to_xdr(env));
    payload.append(&sub.plan_tier.to_xdr(env));
    payload.append(&sub.expiration.to_xdr(env));
    payload.append(&env.ledger().timestamp().to_xdr(env));
    payload
}

#[contract]
pub struct SubscriptionRegistry;

#[contractimpl]
impl SubscriptionRegistry {
    pub fn __constructor(env: Env, admin: Address, plan_factory: Address) {
        assert!(!read_initialized(&env), "Already initialized");
        write_admin(&env, &admin);
        env.storage().instance().set(&DataKey::PlanFactoryAddr, &plan_factory);
        env.storage().instance().set(&DataKey::NextTokenId, &1u128);
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

    pub fn pause(env: Env, admin: Address) {
        let stored = read_admin(&env);
        assert_eq!(admin, stored);
        admin.require_auth();
        write_paused(&env, true);
    }

    pub fn unpause(env: Env, admin: Address) {
        let stored = read_admin(&env);
        assert_eq!(admin, stored);
        admin.require_auth();
        write_paused(&env, false);
    }

    pub fn authorize_biller(env: Env, admin: Address, biller: Address) {
        let stored = read_admin(&env);
        assert_eq!(admin, stored);
        admin.require_auth();
        env.storage().persistent().set(&DataKey::AuthorizedBiller(biller.clone()), &true);
        BillerAuthorized { biller }.publish(&env);
    }

    pub fn revoke_biller(env: Env, admin: Address, biller: Address) {
        let stored = read_admin(&env);
        assert_eq!(admin, stored);
        admin.require_auth();
        env.storage().persistent().set(&DataKey::AuthorizedBiller(biller.clone()), &false);
        BillerRevoked { biller }.publish(&env);
    }

    pub fn authorize_bridge(env: Env, admin: Address, bridge: Address) {
        let stored = read_admin(&env);
        assert_eq!(admin, stored);
        admin.require_auth();
        env.storage().persistent().set(&DataKey::AuthorizedBridge(bridge.clone()), &true);
        BridgeAuthorized { bridge }.publish(&env);
    }

    pub fn revoke_bridge(env: Env, admin: Address, bridge: Address) {
        let stored = read_admin(&env);
        assert_eq!(admin, stored);
        admin.require_auth();
        env.storage().persistent().set(&DataKey::AuthorizedBridge(bridge.clone()), &false);
        BridgeRevoked { bridge }.publish(&env);
    }

    pub fn set_cross_chain_transports(
        env: Env,
        admin: Address,
        axelar_transport: Address,
        ccip_transport: Address,
    ) {
        let stored = read_admin(&env);
        assert_eq!(admin, stored);
        admin.require_auth();
        env.storage().instance().set(&DataKey::AxelarTransport, &axelar_transport);
        env.storage().instance().set(&DataKey::CcipTransport, &ccip_transport);
    }

    pub fn finalize_migration(env: Env, admin: Address) {
        let stored = read_admin(&env);
        assert_eq!(admin, stored);
        admin.require_auth();
        assert!(migration_enabled(&env), "Migration already finalized");
        env.storage().instance().set(&DataKey::MigrationEnabled, &false);
        RegistryMigrationFinalized {}.publish(&env);
    }

    pub fn import_subscription(
        env: Env,
        admin: Address,
        to: Address,
        token_id: u128,
        plan_id: u128,
        expiration: u64,
    ) {
        let stored = read_admin(&env);
        assert_eq!(admin, stored);
        admin.require_auth();
        require_not_paused(&env);
        assert!(migration_enabled(&env), "Migration not enabled");
        assert!(expiration > env.ledger().timestamp(), "Already expired");

        if env.storage().persistent().has(&DataKey::SubscriptionByToken(token_id)) {
            panic!("Token already exists");
        }
        if env.storage().persistent().has(&DataKey::SubscriptionByWallet(to.clone())) {
            panic!("Wallet already has a subscription");
        }

        let plan_factory = read_plan_factory_addr(&env);

        let plan_tier = Self::resolve_plan_tier(&env, &plan_factory, plan_id);
        let now = env.ledger().timestamp();

        let sub = SubscriptionRecord {
            token_id,
            owner: to.clone(),
            plan_id,
            plan_tier,
            expiration,
            active: true,
            minted_at: now,
            last_renewed_at: now,
            total_paid: 0,
        };

        write_subscription(&env, token_id, &sub);

        SubscriptionImported { subscriber: to, token_id, plan_id, expiration }.publish(&env);
        SubscriptionUpdate { token_id, expiration }.publish(&env);
    }

    pub fn mint(
        env: Env,
        biller: Address,
        to: Address,
        plan_id: u128,
        duration: u64,
    ) -> u128 {
        biller.require_auth();
        require_biller(&env, &biller);
        require_not_paused(&env);
        assert!(duration > 0, "Duration must be positive");

        let now = env.ledger().timestamp();
        let expiration = now + duration;

        if env.storage().persistent().has(&DataKey::SubscriptionByWallet(to.clone())) {
            let existing_token_id: u128 = env.storage().persistent().get(&DataKey::SubscriptionByWallet(to.clone())).unwrap();
            let existing = read_subscription(&env, existing_token_id);
            if existing.plan_id == plan_id {
                let mut sub = existing;
                if sub.expiration < now {
                    sub.expiration = expiration;
                } else {
                    sub.expiration += duration;
                }
                sub.last_renewed_at = now;
                write_subscription(&env, existing_token_id, &sub);
                SubscriptionRenewed { token_id: existing_token_id, new_expiration: sub.expiration, amount_paid: 0 }.publish(&env);
                SubscriptionUpdate { token_id: existing_token_id, expiration: sub.expiration }.publish(&env);
                return existing_token_id;
            }
        }

        let plan_factory = read_plan_factory_addr(&env);
        let plan_tier = Self::resolve_plan_tier(&env, &plan_factory, plan_id);

        let token_id = increment_token_id(&env);

        let sub = SubscriptionRecord {
            token_id,
            owner: to.clone(),
            plan_id,
            plan_tier,
            expiration,
            active: true,
            minted_at: now,
            last_renewed_at: now,
            total_paid: 0,
        };

        write_subscription(&env, token_id, &sub);

        SubscriptionMinted { subscriber: to, token_id, plan_id, expiration }.publish(&env);
        SubscriptionUpdate { token_id, expiration }.publish(&env);

        token_id
    }

    pub fn renew(
        env: Env,
        biller: Address,
        token_id: u128,
        extension: u64,
    ) {
        biller.require_auth();
        require_biller(&env, &biller);
        require_not_paused(&env);
        assert!(extension > 0, "Extension must be positive");

        let mut sub = read_subscription(&env, token_id);
        let now = env.ledger().timestamp();

        if sub.expiration < now {
            sub.expiration = now + extension;
        } else {
            sub.expiration += extension;
        }
        sub.last_renewed_at = now;

        write_subscription(&env, token_id, &sub);

        SubscriptionRenewed { token_id, new_expiration: sub.expiration, amount_paid: 0 }.publish(&env);
        SubscriptionUpdate { token_id, expiration: sub.expiration }.publish(&env);
    }

    pub fn cancel(env: Env, caller: Address, token_id: u128) {
        caller.require_auth();
        require_not_paused(&env);

        let sub = read_subscription(&env, token_id);
        assert!(
            caller == sub.owner || is_biller(&env, &caller),
            "Not owner and not authorized biller"
        );

        let mut sub = sub;
        sub.expiration = env.ledger().timestamp();
        sub.active = false;
        write_subscription(&env, token_id, &sub);

        SubscriptionCancelled { token_id }.publish(&env);
        SubscriptionUpdate { token_id, expiration: sub.expiration }.publish(&env);
    }

    pub fn cancel_subscription(env: Env, owner: Address, token_id: u128) {
        owner.require_auth();
        require_not_paused(&env);

        let sub = read_subscription(&env, token_id);
        assert_eq!(sub.owner, owner, "Not the subscription owner");

        let mut sub = sub;
        sub.expiration = env.ledger().timestamp();
        sub.active = false;
        write_subscription(&env, token_id, &sub);

        SubscriptionCancelled { token_id }.publish(&env);
        SubscriptionUpdate { token_id, expiration: sub.expiration }.publish(&env);
    }

    pub fn change_plan(env: Env, biller: Address, token_id: u128, new_plan_id: u128) {
        biller.require_auth();
        require_biller(&env, &biller);
        require_not_paused(&env);

        let mut sub = read_subscription(&env, token_id);
        let previous_plan_id = sub.plan_id;

        let plan_factory = read_plan_factory_addr(&env);
        let plan_tier = Self::resolve_plan_tier(&env, &plan_factory, new_plan_id);

        sub.plan_id = new_plan_id;
        sub.plan_tier = plan_tier;
        write_subscription(&env, token_id, &sub);

        SubscriptionPlanChanged { token_id, previous_plan_id, new_plan_id, expiration: sub.expiration }.publish(&env);
    }

    pub fn is_valid(env: Env, token_id: u128) -> bool {
        let sub: Option<SubscriptionRecord> = env.storage().persistent().get(&DataKey::SubscriptionByToken(token_id));
        match sub {
            Some(s) => s.active && s.expiration > env.ledger().timestamp(),
            None => false,
        }
    }

    pub fn expires_at(env: Env, token_id: u128) -> u64 {
        let sub = read_subscription(&env, token_id);
        sub.expiration
    }

    pub fn is_renewable(env: Env, token_id: u128) -> bool {
        env.storage().persistent().has(&DataKey::SubscriptionByToken(token_id))
    }

    pub fn get_wallet_subscription(env: Env, wallet: Address) -> u128 {
        env.storage()
            .persistent()
            .get(&DataKey::SubscriptionByWallet(wallet))
            .unwrap_or(0)
    }

    pub fn has_active_subscription(env: Env, wallet: Address) -> bool {
        let token_id: u128 = env.storage().persistent().get(&DataKey::SubscriptionByWallet(wallet)).unwrap_or(0);
        if token_id == 0 {
            return false;
        }
        Self::is_valid(env, token_id)
    }

    pub fn get_plan_features(env: Env, token_id: u128) -> (u128, String) {
        let sub = read_subscription(&env, token_id);
        (sub.plan_id, sub.plan_tier)
    }

    pub fn get_plan_id(env: Env, token_id: u128) -> u128 {
        let sub = read_subscription(&env, token_id);
        sub.plan_id
    }

    pub fn get_subscription(env: Env, token_id: u128) -> SubscriptionRecord {
        read_subscription(&env, token_id)
    }

    pub fn get_subscription_by_wallet(env: Env, wallet: Address) -> Option<SubscriptionRecord> {
        let token_id: u128 = env.storage().persistent().get(&DataKey::SubscriptionByWallet(wallet)).unwrap_or(0);
        if token_id == 0 {
            return None;
        }
        Some(read_subscription(&env, token_id))
    }

    pub fn dispatch_cross_chain_update(
        env: Env,
        biller: Address,
        token_id: u128,
        destination_chain_id: u64,
    ) {
        biller.require_auth();
        require_biller(&env, &biller);
        require_not_paused(&env);

        let sub = read_subscription(&env, token_id);
        let payload = build_mirror_payload(&env, &sub);
        let payload_hash: BytesN<32> = env.crypto().sha256(&payload);

        let route: u32 = if env.storage().instance().has(&DataKey::AxelarTransport) {
            1
        } else if env.storage().instance().has(&DataKey::CcipTransport) {
            2
        } else {
            0
        };

        CrossChainDispatchRequested { token_id, destination_chain_id, route, payload_hash }.publish(&env);
    }

    pub fn get_pending_balance(env: Env, address: Address) -> i128 {
        0i128
    }
}

impl SubscriptionRegistry {
    fn resolve_plan_tier(env: &Env, plan_factory: &Address, plan_id: u128) -> String {
        let mut args = Vec::new(env);
        args.push_back(plan_id.into_val(env));
        let result: String = env
            .invoke_contract(
                plan_factory,
                &soroban_sdk::Symbol::new(env, "get_plan_tier"),
                args,
            )
            .try_into_val(env)
            .unwrap_or(String::from_slice(env, "unknown"));
        result
    }
}
