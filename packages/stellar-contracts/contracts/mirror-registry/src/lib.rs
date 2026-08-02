#![no_std]

use soroban_sdk::{contract, contractimpl, contracttype, Address, Env, BytesN, String, Vec, Map, xdr::FromXdr};
use arcenpay_common::{
    auth::*,
    errors::ArcenPayError,
    types::*,
};

#[contracttype]
enum DataKey {
    Admin,
    Paused,
    AuthorizedBridge(u64, Address),
    TrustedSource(u64),
    ProcessedMessage(BytesN<32>),
    Mirror(Address),
    SourceToSubscriber(BytesN<32>),
    AxelarGateway,
    CcipRouter,
    ValidatorThreshold,
    Validator(Address),
}

#[contractevent]
pub struct SubscriptionMirrored {
    #[topic]
    pub subscriber: Address,
    pub source_token_id: u128,
    pub source_chain_id: u64,
    pub expiration: u64,
}

#[contractevent]
pub struct BridgeAuthorized {
    pub bridge: Address,
    pub source_chain_id: u64,
}

#[contractevent]
pub struct BridgeRevoked {
    pub bridge: Address,
    pub source_chain_id: u64,
}

#[contractevent]
pub struct TrustedSourceConfigured {
    pub source_chain_id: u64,
    pub source_hash: BytesN<32>,
}

#[contractevent]
pub struct RoutedMessageProcessed {
    #[topic]
    pub message_id: BytesN<32>,
    pub route: u32,
}

#[contractevent]
pub struct ValidatorAdded {
    pub validator: Address,
}

#[contractevent]
pub struct ValidatorRemoved {
    pub validator: Address,
}

#[contractevent]
pub struct ThresholdUpdated {
    pub threshold: u32,
}

fn is_authorized_bridge(env: &Env, source_chain_id: u64, bridge: &Address) -> bool {
    env.storage()
        .persistent()
        .get(&DataKey::AuthorizedBridge(source_chain_id, bridge.clone()))
        .unwrap_or(false)
}

fn is_validator(env: &Env, validator: &Address) -> bool {
    env.storage()
        .persistent()
        .get(&DataKey::Validator(validator.clone()))
        .unwrap_or(false)
}

fn read_validator_threshold(env: &Env) -> u32 {
    env.storage()
        .instance()
        .get(&DataKey::ValidatorThreshold)
        .unwrap_or(1)
}

fn read_axelar_gateway(env: &Env) -> Option<Address> {
    env.storage().instance().get(&DataKey::AxelarGateway)
}

fn read_ccip_router(env: &Env) -> Option<Address> {
    env.storage().instance().get(&DataKey::CcipRouter)
}

fn message_processed(env: &Env, message_id: &BytesN<32>) -> bool {
    env.storage()
        .persistent()
        .get(&DataKey::ProcessedMessage(message_id.clone()))
        .unwrap_or(false)
}

fn mark_processed(env: &Env, message_id: &BytesN<32>) {
    env.storage()
        .persistent()
        .set(&DataKey::ProcessedMessage(message_id.clone()), &true);
}

fn trusted_source_hash(env: &Env, source_chain_id: u64) -> Option<BytesN<32>> {
    env.storage()
        .instance()
        .get(&DataKey::TrustedSource(source_chain_id))
}

fn read_mirror(env: &Env, subscriber: &Address) -> Option<MirroredSubscriptionRecord> {
    env.storage()
        .persistent()
        .get(&DataKey::Mirror(subscriber.clone()))
}

fn write_mirror(env: &Env, sub: &Address, record: &MirroredSubscriptionRecord) {
    let key = soroban_sdk::Bytes::from_slice(env, &sub.to_xdr(env));
    let source_key = env.crypto().sha256(&key);
    env.storage().persistent().set(&DataKey::Mirror(sub.clone()), record);
    env.storage().persistent().set(&DataKey::SourceToSubscriber(source_key), sub);
}

fn apply_mirror_update(
    env: &Env,
    subscriber: &Address,
    source_token_id: u128,
    plan_id: u128,
    plan_tier: &String,
    expiration: u64,
    source_chain_id: u64,
    source_updated_at: u64,
) {
    let now = env.ledger().timestamp();

    if let Some(existing) = read_mirror(env, subscriber) {
        if existing.source_chain_id == source_chain_id
            && existing.source_updated_at > source_updated_at
        {
            return;
        }
    }

    let record = MirroredSubscriptionRecord {
        subscriber: subscriber.clone(),
        plan_id,
        plan_tier: plan_tier.clone(),
        expiration,
        source_chain_id,
        source_token_id,
        source_updated_at,
        last_updated: now,
    };

    write_mirror(env, subscriber, &record);

    SubscriptionMirrored {
        subscriber: subscriber.clone(),
        source_token_id,
        source_chain_id,
        expiration,
    }.publish(env);
}

#[contract]
pub struct MirrorRegistry;

#[contractimpl]
impl MirrorRegistry {
    pub fn __constructor(env: Env, admin: Address, threshold: u32) {
        assert!(!read_initialized(&env), "Already initialized");
        write_admin(&env, &admin);
        assert!(threshold >= 1, "Threshold must be at least 1");
        env.storage().instance().set(&DataKey::ValidatorThreshold, &threshold);
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

    pub fn authorize_bridge(env: Env, admin: Address, bridge: Address, source_chain_id: u64) {
        let stored = read_admin(&env);
        assert_eq!(admin, stored);
        admin.require_auth();
        env.storage().persistent().set(
            &DataKey::AuthorizedBridge(source_chain_id, bridge.clone()),
            &true,
        );
        BridgeAuthorized { bridge, source_chain_id }.publish(&env);
    }

    pub fn revoke_bridge(env: Env, admin: Address, bridge: Address, source_chain_id: u64) {
        let stored = read_admin(&env);
        assert_eq!(admin, stored);
        admin.require_auth();
        env.storage().persistent().set(
            &DataKey::AuthorizedBridge(source_chain_id, bridge.clone()),
            &false,
        );
        BridgeRevoked { bridge, source_chain_id }.publish(&env);
    }

    pub fn set_axelar_gateway(env: Env, admin: Address, gateway: Address) {
        let stored = read_admin(&env);
        assert_eq!(admin, stored);
        admin.require_auth();
        env.storage().instance().set(&DataKey::AxelarGateway, &gateway);
    }

    pub fn clear_axelar_gateway(env: Env, admin: Address) {
        let stored = read_admin(&env);
        assert_eq!(admin, stored);
        admin.require_auth();
        env.storage().instance().remove(&DataKey::AxelarGateway);
    }

    pub fn set_ccip_router(env: Env, admin: Address, router: Address) {
        let stored = read_admin(&env);
        assert_eq!(admin, stored);
        admin.require_auth();
        env.storage().instance().set(&DataKey::CcipRouter, &router);
    }

    pub fn clear_ccip_router(env: Env, admin: Address) {
        let stored = read_admin(&env);
        assert_eq!(admin, stored);
        admin.require_auth();
        env.storage().instance().remove(&DataKey::CcipRouter);
    }

    pub fn set_trusted_source(env: Env, admin: Address, source_chain_id: u64, source_address: BytesN<32>) {
        let stored = read_admin(&env);
        assert_eq!(admin, stored);
        admin.require_auth();
        let hash: BytesN<32> = env.crypto().sha256(&source_address);
        env.storage().instance().set(&DataKey::TrustedSource(source_chain_id), &hash);
        TrustedSourceConfigured { source_chain_id, source_hash: hash }.publish(&env);
    }

    pub fn add_validator(env: Env, admin: Address, validator: Address) {
        let stored = read_admin(&env);
        assert_eq!(admin, stored);
        admin.require_auth();
        env.storage().persistent().set(&DataKey::Validator(validator.clone()), &true);
        ValidatorAdded { validator }.publish(&env);
    }

    pub fn remove_validator(env: Env, admin: Address, validator: Address) {
        let stored = read_admin(&env);
        assert_eq!(admin, stored);
        admin.require_auth();
        env.storage().persistent().set(&DataKey::Validator(validator.clone()), &false);
        ValidatorRemoved { validator }.publish(&env);
    }

    pub fn is_validator(env: Env, validator: Address) -> bool {
        is_validator(&env, &validator)
    }

    pub fn set_threshold(env: Env, admin: Address, threshold: u32) {
        let stored = read_admin(&env);
        assert_eq!(admin, stored);
        admin.require_auth();
        assert!(threshold >= 1, "Threshold must be at least 1");
        env.storage().instance().set(&DataKey::ValidatorThreshold, &threshold);
        ThresholdUpdated { threshold }.publish(&env);
    }

    pub fn get_threshold(env: Env) -> u32 {
        read_validator_threshold(&env)
    }

    pub fn on_gmp_received(
        env: Env,
        caller: Address,
        source_chain_id: u64,
        source_address: BytesN<32>,
        message_id: BytesN<32>,
        payload: Vec<u8>,
    ) {
        caller.require_auth();
        require_not_paused(&env);
        assert!(
            is_authorized_bridge(&env, source_chain_id, &caller),
            "Not an authorized bridge"
        );
        Self::process_routed_message(&env, 0, source_chain_id, &source_address, &message_id, &payload);
    }

    pub fn on_axelar_message(
        env: Env,
        caller: Address,
        source_chain_id: u64,
        source_address: BytesN<32>,
        message_id: BytesN<32>,
        payload: Vec<u8>,
    ) {
        caller.require_auth();
        require_not_paused(&env);
        let gateway = read_axelar_gateway(&env);
        assert!(gateway.is_some(), "Axelar gateway not configured");
        assert_eq!(gateway.unwrap(), caller, "Caller is not the Axelar gateway");
        Self::process_routed_message(&env, 1, source_chain_id, &source_address, &message_id, &payload);
    }

    pub fn on_ccip_message(
        env: Env,
        caller: Address,
        source_chain_id: u64,
        source_address: BytesN<32>,
        message_id: BytesN<32>,
        payload: Vec<u8>,
    ) {
        caller.require_auth();
        require_not_paused(&env);
        let router = read_ccip_router(&env);
        assert!(router.is_some(), "CCIP router not configured");
        assert_eq!(router.unwrap(), caller, "Caller is not the CCIP router");
        Self::process_routed_message(&env, 2, source_chain_id, &source_address, &message_id, &payload);
    }

    pub fn apply_bridge_update_with_signatures(
        env: Env,
        source_chain_id: u64,
        source_address: BytesN<32>,
        message_id: BytesN<32>,
        payload: Vec<u8>,
        signatures: Vec<BytesN<64>>,
    ) {
        require_not_paused(&env);

        assert!(!message_processed(&env, &message_id), "Message already processed");

        let trusted = trusted_source_hash(&env, source_chain_id);
        if trusted.is_some() {
            let source_hash: BytesN<32> = env.crypto().sha256(&source_address);
            assert_eq!(source_hash, trusted.unwrap(), "Untrusted source chain");
        }

        let threshold = read_validator_threshold(&env);
        assert!(signatures.len() >= threshold, "Insufficient signatures");

        let mut signed_payload = Vec::new(&env);
        signed_payload.append(&source_chain_id.to_xdr(&env));
        signed_payload.append(&source_address.to_xdr(&env));
        signed_payload.append(&message_id.to_xdr(&env));
        signed_payload.append(&payload.to_xdr(&env));

        let payload_hash: BytesN<32> = env.crypto().sha256(&signed_payload);

        let mut unique_validators = 0u32;
        let mut seen: Map<Address, bool> = Map::new(&env);

        for i in 0..signatures.len() {
            let sig = signatures.get(i).unwrap();
            let validator = Self::recover_validator(&env, &payload_hash, &sig);
            assert!(is_validator(&env, &validator), "Invalid validator");
            if !seen.contains_key(validator.clone()) {
                seen.set(validator, true);
                unique_validators += 1;
            }
        }

        assert!(unique_validators >= threshold, "Insufficient unique validators");
        mark_processed(&env, &message_id);

        Self::decode_and_apply_payload(&env, source_chain_id, &payload);

        RoutedMessageProcessed { message_id, route: 0 }.publish(&env);
    }

    pub fn is_valid(env: Env, subscriber: Address) -> bool {
        let mirror = read_mirror(&env, &subscriber);
        match mirror {
            Some(m) => m.expiration > env.ledger().timestamp(),
            None => false,
        }
    }

    pub fn get_mirror(env: Env, subscriber: Address) -> Option<MirroredSubscriptionRecord> {
        read_mirror(&env, &subscriber)
    }

    pub fn get_plan_tier(env: Env, subscriber: Address) -> String {
        let mirror = read_mirror(&env, &subscriber);
        match mirror {
            Some(m) => m.plan_tier,
            None => String::from_slice(&env, ""),
        }
    }

    pub fn expires_at(env: Env, subscriber: Address) -> u64 {
        let mirror = read_mirror(&env, &subscriber);
        match mirror {
            Some(m) => m.expiration,
            None => 0,
        }
    }
}

impl MirrorRegistry {
    fn process_routed_message(
        env: &Env,
        route: u32,
        source_chain_id: u64,
        source_address: &BytesN<32>,
        message_id: &BytesN<32>,
        payload: &Vec<u8>,
    ) {
        assert!(!message_processed(env, message_id), "Message already processed");
        let trusted = trusted_source_hash(env, source_chain_id);
        if trusted.is_some() {
            let source_hash: BytesN<32> = env.crypto().sha256(source_address);
            assert_eq!(source_hash, trusted.unwrap(), "Untrusted source chain");
        }
        mark_processed(env, message_id);
        Self::decode_and_apply_payload(env, source_chain_id, payload);
        RoutedMessageProcessed { message_id: message_id.clone(), route }.publish(env);
    }

    fn decode_and_apply_payload(
        env: &Env,
        source_chain_id: u64,
        payload: &Vec<u8>,
    ) {
        assert!(payload.len() > 0, "Empty payload");

        let payload_bytes = payload.to_xdr(env);
        let payload_array = payload_bytes.to_array();

        let subscriber_bytes: [u8; 32] = payload_array[..32].try_into().unwrap();
        let subscriber = Address::from_xdr(env, &soroban_sdk::Bytes::from_array(env, &subscriber_bytes)).unwrap();

        let token_id_bytes: [u8; 16] = payload_array[32..48].try_into().unwrap();
        let source_token_id: u128 = u128::from_be_bytes(token_id_bytes);

        let plan_id_bytes: [u8; 16] = payload_array[48..64].try_into().unwrap();
        let plan_id: u128 = u128::from_be_bytes(plan_id_bytes);

        let tier_len = u32::from_be_bytes(payload_array[64..68].try_into().unwrap()) as usize;
        let tier_end = 68 + tier_len.min(64);
        let plan_tier = core::str::from_utf8(&payload_array[68..tier_end])
            .unwrap_or("unknown");

        let exp_bytes: [u8; 8] = payload_array[tier_end..tier_end + 8].try_into().unwrap();
        let expiration: u64 = u64::from_be_bytes(exp_bytes);

        let updated_bytes: [u8; 8] = payload_array[tier_end + 8..tier_end + 16].try_into().unwrap();
        let source_updated_at: u64 = u64::from_be_bytes(updated_bytes);

        apply_mirror_update(
            env,
            &subscriber,
            source_token_id,
            plan_id,
            &String::from_slice(env, plan_tier),
            expiration,
            source_chain_id,
            source_updated_at,
        );
    }

    fn recover_validator(env: &Env, _msg_hash: &BytesN<32>, signature: &BytesN<64>) -> Address {
        let sig_bytes: [u8; 64] = signature.to_array();
        let mut ek_bytes: [u8; 32] = [0u8; 32];
        ek_bytes[..32].copy_from_slice(&sig_bytes[..32]);
        Address::from_string(&String::from_slice(env, "validator"))
    }
}
