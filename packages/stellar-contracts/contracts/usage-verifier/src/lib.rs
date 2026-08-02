#![no_std]

use soroban_sdk::{contract, contractimpl, contracttype, Address, Env, BytesN, Vec, xdr::FromXdr, xdr::ToXdr};
use arcenpay_common::{
    auth::*,
    errors::ArcenPayError,
};

#[contracttype]
enum DataKey {
    Admin,
    Paused,
    SessionVaultAddr,
    FeeCollectorAddr,
    PlanFactoryAddr,
    Groth16VerifierAddr,
    UsedNullifier(BytesN<32>),
    RateSchedule(u128),
    SessionPlanId(BytesN<32>),
    SessionProvider(BytesN<32>),
}

#[contractevent]
pub struct BillingSettled {
    #[topic]
    pub session_id: BytesN<32>,
    pub agent_address: BytesN<32>,
    pub call_count: u128,
    pub settlement_amount: i128,
    pub window_start: u64,
    pub window_end: u64,
}

#[contractevent]
pub struct Groth16VerifierSet {
    pub verifier: Address,
}

#[contractevent]
pub struct SessionSettlementConfigured {
    #[topic]
    pub session_id: BytesN<32>,
    pub plan_id: u128,
    pub provider: Address,
}

#[contractevent]
pub struct RateScheduleSet {
    pub plan_id: u128,
    pub rate_per_call: i128,
}

fn read_session_vault(env: &Env) -> Address {
    env.storage()
        .instance()
        .get(&DataKey::SessionVaultAddr)
        .expect("SessionVault not configured")
}

fn read_fee_collector(env: &Env) -> Address {
    env.storage()
        .instance()
        .get(&DataKey::FeeCollectorAddr)
        .expect("FeeCollector not configured")
}

fn read_plan_factory(env: &Env) -> Address {
    env.storage()
        .instance()
        .get(&DataKey::PlanFactoryAddr)
        .expect("PlanFactory not configured")
}

fn read_groth16_verifier(env: &Env) -> Address {
    env.storage()
        .instance()
        .get(&DataKey::Groth16VerifierAddr)
        .expect("Groth16 verifier not configured")
}

fn is_nullifier_used(env: &Env, nullifier: &BytesN<32>) -> bool {
    env.storage()
        .persistent()
        .get(&DataKey::UsedNullifier(nullifier.clone()))
        .unwrap_or(false)
}

fn mark_nullifier_used(env: &Env, nullifier: &BytesN<32>) {
    env.storage()
        .persistent()
        .set(&DataKey::UsedNullifier(nullifier.clone()), &true);
}

fn get_rate(env: &Env, session_id: &BytesN<32>) -> i128 {
    let plan_id: u128 = env
        .storage()
        .persistent()
        .get(&DataKey::SessionPlanId(session_id.clone()))
        .unwrap_or(0);
    let rate: i128 = env.storage().persistent().get(&DataKey::RateSchedule(plan_id)).unwrap_or(0);
    if rate == 0 {
        let fallback: i128 = env.storage().persistent().get(&DataKey::RateSchedule(0)).unwrap_or(0);
        assert!(fallback > 0, "Rate schedule not configured");
        return fallback;
    }
    rate
}

fn resolve_provider(env: &Env, session_id: &BytesN<32>, plan_id: u128) -> Address {
    let stored: Option<Address> = env
        .storage()
        .persistent()
        .get(&DataKey::SessionProvider(session_id.clone()));
    if let Some(provider) = stored {
        return provider;
    }

    let plan_factory = read_plan_factory(env);
    let provider: Address = env
        .invoke_contract(
            &plan_factory,
            &soroban_sdk::Symbol::new(env, "get_plan_provider"),
            Vec::from_array(env, [plan_id.into_val(env)]),
        )
        .try_into_val(env)
        .expect("Failed to resolve plan provider");
    provider
}

fn address_to_bytes32(env: &Env, addr: &Address) -> BytesN<32> {
    let xdr = addr.to_xdr(env);
    let hash = env.crypto().sha256(&xdr);
    hash
}

#[contract]
pub struct UsageVerifier;

#[contractimpl]
impl UsageVerifier {
    pub fn __constructor(
        env: Env,
        admin: Address,
        session_vault: Address,
        fee_collector: Address,
        plan_factory: Address,
    ) {
        assert!(!read_initialized(&env), "Already initialized");
        write_admin(&env, &admin);
        env.storage().instance().set(&DataKey::SessionVaultAddr, &session_vault);
        env.storage().instance().set(&DataKey::FeeCollectorAddr, &fee_collector);
        env.storage().instance().set(&DataKey::PlanFactoryAddr, &plan_factory);
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

    pub fn set_rate_schedule(env: Env, admin: Address, plan_id: u128, rate_per_call: i128) {
        let stored = read_admin(&env);
        assert_eq!(admin, stored);
        admin.require_auth();
        assert!(rate_per_call > 0, "Rate must be positive");
        env.storage().persistent().set(&DataKey::RateSchedule(plan_id), &rate_per_call);
        RateScheduleSet { plan_id, rate_per_call }.publish(&env);
    }

    pub fn set_session_settlement_config(
        env: Env,
        admin: Address,
        session_id: BytesN<32>,
        plan_id: u128,
        provider: Option<Address>,
    ) {
        let stored = read_admin(&env);
        assert_eq!(admin, stored);
        admin.require_auth();

        env.storage().persistent().set(&DataKey::SessionPlanId(session_id.clone()), &plan_id);

        let resolved_provider = match provider {
            Some(p) => p,
            None => {
                let plan_factory = read_plan_factory(&env);
                let p: Address = env
                    .invoke_contract(
                        &plan_factory,
                        &soroban_sdk::Symbol::new(&env, "get_plan_provider"),
                        Vec::from_array(&env, [plan_id.into_val(&env)]),
                    )
                    .try_into_val(&env)
                    .expect("Failed to resolve plan provider");
                p
            }
        };

        env.storage().persistent().set(&DataKey::SessionProvider(session_id.clone()), &resolved_provider);

        SessionSettlementConfigured { session_id, plan_id, provider: resolved_provider }.publish(&env);
    }

    pub fn set_groth16_verifier(env: Env, admin: Address, verifier: Address) {
        let stored = read_admin(&env);
        assert_eq!(admin, stored);
        admin.require_auth();
        env.storage().instance().set(&DataKey::Groth16VerifierAddr, &verifier);
        Groth16VerifierSet { verifier }.publish(&env);
    }

    pub fn is_nullifier_used(env: Env, nullifier: BytesN<32>) -> bool {
        is_nullifier_used(&env, &nullifier)
    }

    pub fn get_rate_schedule(env: Env, plan_id: u128) -> i128 {
        env.storage()
            .persistent()
            .get(&DataKey::RateSchedule(plan_id))
            .unwrap_or(0)
    }

    pub fn submit_proof(
        env: Env,
        caller: Address,
        agent_address: BytesN<32>,
        session_id: BytesN<32>,
        call_count: u128,
        window_start: u64,
        window_end: u64,
        merkle_root: BytesN<32>,
        nullifier: BytesN<32>,
    ) {
        caller.require_auth();
        require_not_paused(&env);

        assert!(call_count > 0, "Call count must be positive");
        assert!(window_end > window_start, "Invalid time window");
        assert!(window_end <= env.ledger().timestamp(), "Window not yet closed");
        assert!(agent_address != BytesN::from_array(&env, &[0u8; 32]), "Invalid agent address");
        assert!(session_id != BytesN::from_array(&env, &[0u8; 32]), "Invalid session ID");

        assert!(!is_nullifier_used(&env, &nullifier), "Nullifier already used");

        let verifier = read_groth16_verifier(&env);
        let verification_result: bool = env
            .invoke_contract(
                &verifier,
                &soroban_sdk::Symbol::new(&env, "verify"),
                Vec::from_array(&env, [
                    agent_address.clone().into_val(&env),
                    session_id.clone().into_val(&env),
                    call_count.into_val(&env),
                    window_start.into_val(&env),
                    window_end.into_val(&env),
                    merkle_root.into_val(&env),
                    nullifier.into_val(&env),
                ]),
            )
            .try_into_val(&env)
            .expect("Proof verification failed");
        assert!(verification_result, "Proof verification failed");

        mark_nullifier_used(&env, &nullifier);

        let rate = get_rate(&env, &session_id);
        let settlement_amount: i128 = (call_count as u128 * rate as u128) as i128;

        let fee_collector = read_fee_collector(&env);
        let session_vault = read_session_vault(&env);
        let plan_factory = read_plan_factory(&env);

        let protocol_fee: i128 = env
            .invoke_contract(
                &fee_collector,
                &soroban_sdk::Symbol::new(&env, "collect_settlement_fee"),
                Vec::from_array(&env, [settlement_amount.into_val(&env)]),
            )
            .try_into_val(&env)
            .unwrap_or(0i128);

        let provider_amount = settlement_amount - protocol_fee;

        let plan_id: u128 = env
            .storage()
            .persistent()
            .get(&DataKey::SessionPlanId(session_id.clone()))
            .unwrap_or(0);
        let provider = resolve_provider(&env, &session_id, plan_id);

        let _: () = env
            .invoke_contract(
                &session_vault,
                &soroban_sdk::Symbol::new(&env, "settle"),
                Vec::from_array(&env, [
                    env.current_contract_address().into_val(&env),
                    session_id.clone().into_val(&env),
                    provider_amount.into_val(&env),
                    provider.clone().into_val(&env),
                ]),
            )
            .try_into_val(&env)
            .expect("Settlement failed");

        BillingSettled {
            session_id,
            agent_address,
            call_count,
            settlement_amount,
            window_start,
            window_end,
        }.publish(&env);
    }
}
