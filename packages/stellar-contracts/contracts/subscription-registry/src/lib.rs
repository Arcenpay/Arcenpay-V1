#![no_std]
#![allow(clippy::too_many_arguments)]

extern crate alloc;

use arcenpay_common::{
    auth::*,
    errors::{ArcenPayError, fail},
    types::*,
};
use soroban_sdk::{
    Address, BytesN, Env, IntoVal, String, contract, contractevent, contractimpl, contracttype,
    xdr::ToXdr,
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
        .unwrap_or_else(|| fail(env, ArcenPayError::NotFound))
}

fn write_subscription(env: &Env, token_id: u128, sub: &SubscriptionRecord) {
    env.storage()
        .persistent()
        .set(&DataKey::SubscriptionByToken(token_id), sub);
    env.storage()
        .persistent()
        .set(&DataKey::SubscriptionByWallet(sub.owner.clone()), &token_id);
}

fn read_plan_factory_addr(env: &Env) -> Address {
    env.storage()
        .instance()
        .get(&DataKey::PlanFactoryAddr)
        .unwrap_or_else(|| fail(env, ArcenPayError::NotInitialized))
}

fn is_biller(env: &Env, biller: &Address) -> bool {
    env.storage()
        .persistent()
        .get(&DataKey::AuthorizedBiller(biller.clone()))
        .unwrap_or(false)
}

fn require_biller(env: &Env, caller: &Address) {
    if !is_biller(env, caller) {
        fail(env, ArcenPayError::UnauthorizedBiller);
    }
}

#[allow(dead_code)]
fn is_bridge(env: &Env, bridge: &Address) -> bool {
    env.storage()
        .persistent()
        .get(&DataKey::AuthorizedBridge(bridge.clone()))
        .unwrap_or(false)
}

#[allow(dead_code)]
fn require_bridge(env: &Env, caller: &Address) {
    if !is_bridge(env, caller) {
        fail(env, ArcenPayError::NotAuthorized);
    }
}

fn migration_enabled(env: &Env) -> bool {
    env.storage()
        .instance()
        .get(&DataKey::MigrationEnabled)
        .unwrap_or(true)
}

fn increment_token_id(env: &Env) -> u128 {
    let id: u128 = env
        .storage()
        .instance()
        .get(&DataKey::NextTokenId)
        .unwrap_or(1);
    env.storage()
        .instance()
        .set(&DataKey::NextTokenId, &(id + 1));
    id
}

fn build_mirror_payload(env: &Env, sub: &SubscriptionRecord) -> BytesN<32> {
    let payload = MirrorPayload {
        subscriber: sub.owner.clone(),
        source_token_id: sub.token_id,
        plan_id: sub.plan_id,
        plan_tier: sub.plan_tier.clone(),
        expiration: sub.expiration,
        source_updated_at: env.ledger().timestamp(),
    };
    let bytes = payload.to_xdr(env);
    env.crypto().sha256(&bytes).into()
}

#[contract]
pub struct SubscriptionRegistry;

#[contractimpl]
impl SubscriptionRegistry {
    pub fn __constructor(env: Env, admin: Address, plan_factory: Address) {
        if read_initialized(&env) {
            fail(&env, ArcenPayError::AlreadyInitialized);
        }
        write_admin(&env, &admin);
        env.storage()
            .instance()
            .set(&DataKey::PlanFactoryAddr, &plan_factory);
        env.storage().instance().set(&DataKey::NextTokenId, &1u128);
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

    pub fn pause(env: Env, admin: Address) {
        let stored = read_admin(&env);
        if admin != stored {
            fail(&env, ArcenPayError::NotAuthorized);
        }
        admin.require_auth();
        write_paused(&env, true);
    }

    pub fn unpause(env: Env, admin: Address) {
        let stored = read_admin(&env);
        if admin != stored {
            fail(&env, ArcenPayError::NotAuthorized);
        }
        admin.require_auth();
        write_paused(&env, false);
    }

    pub fn authorize_biller(env: Env, admin: Address, biller: Address) {
        let stored = read_admin(&env);
        if admin != stored {
            fail(&env, ArcenPayError::NotAuthorized);
        }
        admin.require_auth();
        env.storage()
            .persistent()
            .set(&DataKey::AuthorizedBiller(biller.clone()), &true);
        BillerAuthorized { biller }.publish(&env);
    }

    pub fn revoke_biller(env: Env, admin: Address, biller: Address) {
        let stored = read_admin(&env);
        if admin != stored {
            fail(&env, ArcenPayError::NotAuthorized);
        }
        admin.require_auth();
        env.storage()
            .persistent()
            .set(&DataKey::AuthorizedBiller(biller.clone()), &false);
        BillerRevoked { biller }.publish(&env);
    }

    pub fn authorize_bridge(env: Env, admin: Address, bridge: Address) {
        let stored = read_admin(&env);
        if admin != stored {
            fail(&env, ArcenPayError::NotAuthorized);
        }
        admin.require_auth();
        env.storage()
            .persistent()
            .set(&DataKey::AuthorizedBridge(bridge.clone()), &true);
        BridgeAuthorized { bridge }.publish(&env);
    }

    pub fn revoke_bridge(env: Env, admin: Address, bridge: Address) {
        let stored = read_admin(&env);
        if admin != stored {
            fail(&env, ArcenPayError::NotAuthorized);
        }
        admin.require_auth();
        env.storage()
            .persistent()
            .set(&DataKey::AuthorizedBridge(bridge.clone()), &false);
        BridgeRevoked { bridge }.publish(&env);
    }

    pub fn set_cross_chain_transports(
        env: Env,
        admin: Address,
        axelar_transport: Address,
        ccip_transport: Address,
    ) {
        let stored = read_admin(&env);
        if admin != stored {
            fail(&env, ArcenPayError::NotAuthorized);
        }
        admin.require_auth();
        env.storage()
            .instance()
            .set(&DataKey::AxelarTransport, &axelar_transport);
        env.storage()
            .instance()
            .set(&DataKey::CcipTransport, &ccip_transport);
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
        if admin != stored {
            fail(&env, ArcenPayError::NotAuthorized);
        }
        admin.require_auth();
        require_not_paused(&env);
        if !migration_enabled(&env) {
            fail(&env, ArcenPayError::MigrationNotEnabled);
        }
        if expiration <= env.ledger().timestamp() {
            fail(&env, ArcenPayError::InvalidConfig);
        }

        if env
            .storage()
            .persistent()
            .has(&DataKey::SubscriptionByToken(token_id))
        {
            fail(&env, ArcenPayError::AlreadyExists);
        }
        if env
            .storage()
            .persistent()
            .has(&DataKey::SubscriptionByWallet(to.clone()))
        {
            fail(&env, ArcenPayError::AlreadyExists);
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

        SubscriptionImported {
            subscriber: to,
            token_id,
            plan_id,
            expiration,
        }
        .publish(&env);
        SubscriptionUpdate {
            token_id,
            expiration,
        }
        .publish(&env);
    }

    pub fn mint(
        env: Env,
        biller: Address,
        to: Address,
        plan_id: u128,
        duration: u64,
        amount_paid: i128,
    ) -> u128 {
        biller.require_auth();
        require_biller(&env, &biller);
        require_not_paused(&env);
        if duration == 0 {
            fail(&env, ArcenPayError::InvalidInterval);
        }
        if amount_paid < 0 {
            fail(&env, ArcenPayError::InvalidAmount);
        }

        let plan_factory = read_plan_factory_addr(&env);
        if !Self::plan_is_active(&env, &plan_factory, plan_id) {
            fail(&env, ArcenPayError::PlanNotActive);
        }

        let now = env.ledger().timestamp();

        // EVM behavior: if the wallet already has an active token on the SAME
        // plan, the request silently renews the existing token rather than
        // minting a new one. Match that here.
        if env
            .storage()
            .persistent()
            .has(&DataKey::SubscriptionByWallet(to.clone()))
        {
            let existing_token_id: u128 = env
                .storage()
                .persistent()
                .get(&DataKey::SubscriptionByWallet(to.clone()))
                .unwrap();
            let existing = read_subscription(&env, existing_token_id);
            if existing.plan_id == plan_id {
                let mut sub = existing;
                if sub.expiration < now {
                    sub.expiration = now + duration;
                } else {
                    sub.expiration += duration;
                }
                sub.last_renewed_at = now;
                sub.total_paid += amount_paid;
                // Renewal implicitly re-activates a previously cancelled
                // token (EVM has no `active` flag; the NFT just exists,
                // rolled over by renewal). Match that here.
                sub.active = true;
                write_subscription(&env, existing_token_id, &sub);
                SubscriptionRenewed {
                    token_id: existing_token_id,
                    new_expiration: sub.expiration,
                    amount_paid,
                }
                .publish(&env);
                SubscriptionUpdate {
                    token_id: existing_token_id,
                    expiration: sub.expiration,
                }
                .publish(&env);
                return existing_token_id;
            }
            // Wallet already subscribed to a different plan — require
            // change_plan / cancel flow, not a fresh mint.
            fail(&env, ArcenPayError::AlreadyExists);
        }

        let plan_tier = Self::resolve_plan_tier(&env, &plan_factory, plan_id);

        let token_id = increment_token_id(&env);

        let sub = SubscriptionRecord {
            token_id,
            owner: to.clone(),
            plan_id,
            plan_tier,
            expiration: now + duration,
            active: true,
            minted_at: now,
            last_renewed_at: now,
            total_paid: amount_paid,
        };

        write_subscription(&env, token_id, &sub);

        SubscriptionMinted {
            subscriber: to,
            token_id,
            plan_id,
            expiration: sub.expiration,
        }
        .publish(&env);
        SubscriptionUpdate {
            token_id,
            expiration: sub.expiration,
        }
        .publish(&env);

        token_id
    }

    pub fn renew(env: Env, biller: Address, token_id: u128, extension: u64, amount_paid: i128) {
        biller.require_auth();
        require_biller(&env, &biller);
        require_not_paused(&env);
        if extension == 0 {
            fail(&env, ArcenPayError::InvalidInterval);
        }
        if amount_paid < 0 {
            fail(&env, ArcenPayError::InvalidAmount);
        }

        let mut sub = read_subscription(&env, token_id);
        let plan_factory = read_plan_factory_addr(&env);
        if !Self::plan_is_active(&env, &plan_factory, sub.plan_id) {
            fail(&env, ArcenPayError::PlanNotActive);
        }

        let now = env.ledger().timestamp();
        if sub.expiration < now {
            sub.expiration = now + extension;
        } else {
            sub.expiration += extension;
        }
        sub.last_renewed_at = now;
        sub.total_paid += amount_paid;
        // Renewal implicitly re-activates a previously cancelled token
        // (matches EVM behavior — the NFT just exists, no separate `active`).
        sub.active = true;

        write_subscription(&env, token_id, &sub);

        SubscriptionRenewed {
            token_id,
            new_expiration: sub.expiration,
            amount_paid,
        }
        .publish(&env);
        SubscriptionUpdate {
            token_id,
            expiration: sub.expiration,
        }
        .publish(&env);
    }

    pub fn cancel(env: Env, caller: Address, token_id: u128) {
        caller.require_auth();
        require_not_paused(&env);

        let sub = read_subscription(&env, token_id);
        if caller != sub.owner && !is_biller(&env, &caller) {
            fail(&env, ArcenPayError::NotAuthorized);
        }

        let mut sub = sub;
        sub.expiration = env.ledger().timestamp();
        sub.active = false;
        write_subscription(&env, token_id, &sub);

        SubscriptionCancelled { token_id }.publish(&env);
        SubscriptionUpdate {
            token_id,
            expiration: sub.expiration,
        }
        .publish(&env);
    }

    pub fn cancel_subscription(env: Env, owner: Address, token_id: u128) {
        owner.require_auth();
        require_not_paused(&env);

        let sub = read_subscription(&env, token_id);
        if sub.owner != owner {
            fail(&env, ArcenPayError::NotOwner);
        }

        let mut sub = sub;
        sub.expiration = env.ledger().timestamp();
        sub.active = false;
        write_subscription(&env, token_id, &sub);

        SubscriptionCancelled { token_id }.publish(&env);
        SubscriptionUpdate {
            token_id,
            expiration: sub.expiration,
        }
        .publish(&env);
    }

    pub fn change_plan(env: Env, biller: Address, token_id: u128, new_plan_id: u128) {
        biller.require_auth();
        require_biller(&env, &biller);
        require_not_paused(&env);

        let mut sub = read_subscription(&env, token_id);
        let previous_plan_id = sub.plan_id;
        if previous_plan_id == new_plan_id {
            fail(&env, ArcenPayError::InvalidConfig);
        }

        let plan_factory = read_plan_factory_addr(&env);
        if !Self::plan_is_active(&env, &plan_factory, new_plan_id) {
            fail(&env, ArcenPayError::PlanNotActive);
        }
        let plan_tier = Self::resolve_plan_tier(&env, &plan_factory, new_plan_id);

        sub.plan_id = new_plan_id;
        sub.plan_tier = plan_tier;
        // EVM SubscriptionRegistry.changePlan only swaps plan_id _without_
        // recomputing expiration or charging proration. The FeeCollector
        // proration flow runs out-of-band on the facilitator side today.
        // TODO(stellar): once a FeeCollector cross-contract proration call is
        // implemented, charge/credit the subscriber and adjust expiration.
        write_subscription(&env, token_id, &sub);

        SubscriptionPlanChanged {
            token_id,
            previous_plan_id,
            new_plan_id,
            expiration: sub.expiration,
        }
        .publish(&env);
        SubscriptionUpdate {
            token_id,
            expiration: sub.expiration,
        }
        .publish(&env);
    }

    pub fn is_valid(env: Env, token_id: u128) -> bool {
        let sub: Option<SubscriptionRecord> = env
            .storage()
            .persistent()
            .get(&DataKey::SubscriptionByToken(token_id));
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
        env.storage()
            .persistent()
            .has(&DataKey::SubscriptionByToken(token_id))
    }

    pub fn get_wallet_subscription(env: Env, wallet: Address) -> u128 {
        env.storage()
            .persistent()
            .get(&DataKey::SubscriptionByWallet(wallet))
            .unwrap_or(0)
    }

    pub fn has_active_subscription(env: Env, wallet: Address) -> bool {
        let token_id: u128 = env
            .storage()
            .persistent()
            .get(&DataKey::SubscriptionByWallet(wallet))
            .unwrap_or(0);
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
        let token_id: u128 = env
            .storage()
            .persistent()
            .get(&DataKey::SubscriptionByWallet(wallet))
            .unwrap_or(0);
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
        let payload_hash = build_mirror_payload(&env, &sub);

        let route: u32 = if env.storage().instance().has(&DataKey::AxelarTransport) {
            1
        } else if env.storage().instance().has(&DataKey::CcipTransport) {
            2
        } else {
            0
        };

        CrossChainDispatchRequested {
            token_id,
            destination_chain_id,
            route,
            payload_hash,
        }
        .publish(&env);
    }

    pub fn get_pending_balance(_env: Env, _address: Address) -> i128 {
        0i128
    }
}

impl SubscriptionRegistry {
    fn plan_is_active(env: &Env, plan_factory: &Address, plan_id: u128) -> bool {
        env.invoke_contract::<bool>(
            plan_factory,
            &soroban_sdk::Symbol::new(env, "get_plan_active"),
            soroban_sdk::Vec::from_array(env, [plan_id.into_val(env)]),
        )
    }

    fn resolve_plan_tier(env: &Env, plan_factory: &Address, plan_id: u128) -> String {
        let args = soroban_sdk::Vec::from_array(env, [plan_id.into_val(env)]);
        env.invoke_contract::<String>(
            plan_factory,
            &soroban_sdk::Symbol::new(env, "get_plan_tier"),
            args,
        )
    }
}

#[cfg(test)]
mod tests;
