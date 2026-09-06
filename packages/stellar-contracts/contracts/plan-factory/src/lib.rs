#![no_std]
#![allow(clippy::too_many_arguments)]

extern crate alloc;

use arcenpay_common::{
    auth::*,
    errors::{ArcenPayError, fail},
    types::*,
};
use soroban_sdk::{Address, Env, String, Vec, contract, contractevent, contractimpl, contracttype};

#[contracttype]
enum DataKey {
    Admin,
    Paused,
    NextPlanId,
    Plan(u128),
    ProviderPlans(Address),
    ProviderRegistered(Address),
    ApprovedToken(Address),
    AuthNonce(Address),
}

#[contractevent]
pub struct PlanCreated {
    #[topic]
    pub plan_id: u128,
    pub provider: Address,
    pub name: String,
    pub price: i128,
    pub billing_interval: u64,
}

#[contractevent]
pub struct PlanUpdated {
    #[topic]
    pub plan_id: u128,
    pub price: i128,
    pub metadata_uri: String,
}

#[contractevent]
pub struct PlanDeactivated {
    #[topic]
    pub plan_id: u128,
}

#[contractevent]
pub struct ProviderRegistered {
    #[topic]
    pub provider: Address,
}

#[contractevent]
pub struct TokenApproved {
    pub token: Address,
}

#[contractevent]
pub struct TokenRevoked {
    pub token: Address,
}

fn read_next_plan_id(env: &Env) -> u128 {
    env.storage()
        .instance()
        .get(&DataKey::NextPlanId)
        .unwrap_or(1)
}

fn increment_plan_id(env: &Env) -> u128 {
    let id: u128 = read_next_plan_id(env);
    env.storage()
        .instance()
        .set(&DataKey::NextPlanId, &(id + 1));
    id
}

fn is_provider(env: &Env, provider: &Address) -> bool {
    env.storage()
        .persistent()
        .get(&DataKey::ProviderRegistered(provider.clone()))
        .unwrap_or(false)
}

fn register_provider_if_needed(env: &Env, provider: &Address) {
    if !is_provider(env, provider) {
        env.storage()
            .persistent()
            .set(&DataKey::ProviderRegistered(provider.clone()), &true);
        ProviderRegistered {
            provider: provider.clone(),
        }
        .publish(env);
    }
}

fn read_plan(env: &Env, plan_id: u128) -> PlanRecord {
    env.storage()
        .persistent()
        .get(&DataKey::Plan(plan_id))
        .unwrap_or_else(|| fail(env, ArcenPayError::PlanNotFound))
}

fn write_plan(env: &Env, plan_id: u128, plan: &PlanRecord) {
    env.storage()
        .persistent()
        .set(&DataKey::Plan(plan_id), plan);
    let mut provider_plans: Vec<u128> = env
        .storage()
        .persistent()
        .get(&DataKey::ProviderPlans(plan.provider.clone()))
        .unwrap_or(Vec::new(env));
    let mut found = false;
    for i in 0..provider_plans.len() {
        if provider_plans.get(i).unwrap() == plan_id {
            found = true;
            break;
        }
    }
    if !found {
        provider_plans.push_back(plan_id);
        env.storage().persistent().set(
            &DataKey::ProviderPlans(plan.provider.clone()),
            &provider_plans,
        );
    }
}

fn is_approved_token(env: &Env, token: &Address) -> bool {
    env.storage()
        .persistent()
        .get(&DataKey::ApprovedToken(token.clone()))
        .unwrap_or(false)
}

#[contract]
pub struct PlanFactory;

#[contractimpl]
impl PlanFactory {
    pub fn __constructor(env: Env, admin: Address, approved_tokens: Vec<Address>) {
        if read_initialized(&env) {
            fail(&env, ArcenPayError::AlreadyInitialized);
        }
        write_admin(&env, &admin);
        write_initialized(&env);
        for i in 0..approved_tokens.len() {
            let token = approved_tokens.get(i).unwrap();
            env.storage()
                .persistent()
                .set(&DataKey::ApprovedToken(token.clone()), &true);
            TokenApproved { token }.publish(&env);
        }
        env.storage().instance().set(&DataKey::NextPlanId, &1u128);
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

    pub fn approve_token(env: Env, admin: Address, token: Address) {
        let stored = read_admin(&env);
        if admin != stored {
            fail(&env, ArcenPayError::NotAuthorized);
        }
        admin.require_auth();
        env.storage()
            .persistent()
            .set(&DataKey::ApprovedToken(token.clone()), &true);
        TokenApproved { token }.publish(&env);
    }

    pub fn revoke_token(env: Env, admin: Address, token: Address) {
        let stored = read_admin(&env);
        if admin != stored {
            fail(&env, ArcenPayError::NotAuthorized);
        }
        admin.require_auth();
        env.storage()
            .persistent()
            .set(&DataKey::ApprovedToken(token.clone()), &false);
        TokenRevoked { token }.publish(&env);
    }

    pub fn register_provider(env: Env, admin: Address, provider: Address) {
        let stored = read_admin(&env);
        if admin != stored {
            fail(&env, ArcenPayError::NotAuthorized);
        }
        admin.require_auth();
        register_provider_if_needed(&env, &provider);
    }

    pub fn is_provider(env: Env, provider: Address) -> bool {
        is_provider(&env, &provider)
    }

    pub fn create_plan(
        env: Env,
        provider: Address,
        name: String,
        tier: String,
        price: i128,
        billing_interval: u64,
        accepted_token: Address,
        metadata_uri: String,
    ) -> u128 {
        provider.require_auth();
        if price <= 0 {
            fail(&env, ArcenPayError::ZeroPrice);
        }
        if name.is_empty() {
            fail(&env, ArcenPayError::InvalidConfig);
        }
        if billing_interval < MIN_BILLING_INTERVAL {
            fail(&env, ArcenPayError::InvalidInterval);
        }
        if !is_approved_token(&env, &accepted_token) {
            fail(&env, ArcenPayError::TokenNotApproved);
        }

        register_provider_if_needed(&env, &provider);

        let plan_id = increment_plan_id(&env);
        let plan = PlanRecord {
            id: plan_id,
            provider: provider.clone(),
            name: name.clone(),
            tier: tier.clone(),
            price,
            billing_interval,
            accepted_token: accepted_token.clone(),
            active: true,
            metadata_uri: metadata_uri.clone(),
        };

        write_plan(&env, plan_id, &plan);

        PlanCreated {
            plan_id,
            provider,
            name,
            price,
            billing_interval,
        }
        .publish(&env);

        plan_id
    }

    pub fn update_plan(
        env: Env,
        provider: Address,
        plan_id: u128,
        price: i128,
        metadata_uri: String,
    ) {
        provider.require_auth();
        let mut plan = read_plan(&env, plan_id);
        if plan.provider != provider {
            fail(&env, ArcenPayError::NotAuthorized);
        }
        if price <= 0 {
            fail(&env, ArcenPayError::ZeroPrice);
        }

        plan.price = price;
        plan.metadata_uri = metadata_uri.clone();
        write_plan(&env, plan_id, &plan);

        PlanUpdated {
            plan_id,
            price,
            metadata_uri,
        }
        .publish(&env);
    }

    pub fn deactivate_plan(env: Env, provider: Address, plan_id: u128) {
        provider.require_auth();
        let mut plan = read_plan(&env, plan_id);
        if plan.provider != provider {
            fail(&env, ArcenPayError::NotAuthorized);
        }
        if !plan.active {
            fail(&env, ArcenPayError::PlanNotActive);
        }

        plan.active = false;
        write_plan(&env, plan_id, &plan);

        PlanDeactivated { plan_id }.publish(&env);
    }

    pub fn get_plan(env: Env, plan_id: u128) -> PlanRecord {
        read_plan(&env, plan_id)
    }

    pub fn get_plan_active(env: Env, plan_id: u128) -> bool {
        let plan: Option<PlanRecord> = env.storage().persistent().get(&DataKey::Plan(plan_id));
        match plan {
            Some(p) => p.active,
            None => false,
        }
    }

    pub fn get_plan_provider(env: Env, plan_id: u128) -> Address {
        let plan = read_plan(&env, plan_id);
        plan.provider
    }

    pub fn get_plan_tier(env: Env, plan_id: u128) -> String {
        let plan = read_plan(&env, plan_id);
        plan.tier
    }

    pub fn get_plan_price(env: Env, plan_id: u128) -> i128 {
        let plan = read_plan(&env, plan_id);
        plan.price
    }

    pub fn get_plan_token(env: Env, plan_id: u128) -> Address {
        let plan = read_plan(&env, plan_id);
        plan.accepted_token
    }

    pub fn get_provider_plans(env: Env, provider: Address) -> Vec<u128> {
        env.storage()
            .persistent()
            .get(&DataKey::ProviderPlans(provider))
            .unwrap_or(Vec::new(&env))
    }
}
