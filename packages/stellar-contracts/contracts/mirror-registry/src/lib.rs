#![no_std]
#![allow(clippy::too_many_arguments)]

extern crate alloc;

use arcenpay_common::{
    auth::*,
    errors::{ArcenPayError, fail},
    types::*,
};
use soroban_sdk::{
    Address, BytesN, Env, Map, String, Vec, contract, contractevent, contractimpl, contracttype,
    xdr::FromXdr, xdr::ToXdr,
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
    // Validators are registered by their ed25519 public key so the
    // multi-sig path can verify signatures via `env.crypto().ed25519_verify`.
    Validator(BytesN<32>),
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
    pub validator_pubkey: BytesN<32>,
}

#[contractevent]
pub struct ValidatorRemoved {
    pub validator_pubkey: BytesN<32>,
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

fn is_validator(env: &Env, pubkey: &BytesN<32>) -> bool {
    env.storage()
        .persistent()
        .get(&DataKey::Validator(pubkey.clone()))
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
    // Hash(source_chain_id || source_token_id) -> subscriber, matching the
    // EVM `_sourceToSubscriber[keccak256(abi.encodePacked(chainId, tokenId))]`.
    let mut key_bytes = soroban_sdk::Bytes::new(env);
    key_bytes.append(&source_chain_id_for_hash(env, &record.source_chain_id));
    key_bytes.append(&source_token_id_for_hash(env, &record.source_token_id));
    let source_key: BytesN<32> = env.crypto().sha256(&key_bytes).into();
    env.storage()
        .persistent()
        .set(&DataKey::Mirror(sub.clone()), record);
    env.storage()
        .persistent()
        .set(&DataKey::SourceToSubscriber(source_key), sub);
}

fn source_chain_id_for_hash(env: &Env, chain_id: &u64) -> soroban_sdk::Bytes {
    // u64 big-endian (8 bytes) — cross-chain deterministic encoding.
    let bytes = chain_id.to_be_bytes();
    soroban_sdk::Bytes::from_array(env, &bytes)
}

fn source_token_id_for_hash(env: &Env, token_id: &u128) -> soroban_sdk::Bytes {
    let bytes = token_id.to_be_bytes();
    soroban_sdk::Bytes::from_array(env, &bytes)
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
        // Ignore stale updates from the same source — they can be applied
        // out-of-order across GMP routes.
        if existing.source_chain_id == source_chain_id
            && existing.source_token_id == source_token_id
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
    }
    .publish(env);
}

/// Decodes a cross-chain mirror payload serialized via `MirrorPayload::to_xdr`
/// by the source `SubscriptionRegistry`, and applies the update.
fn decode_and_apply_payload(env: &Env, source_chain_id: u64, payload: soroban_sdk::Bytes) {
    if payload.is_empty() {
        fail(env, ArcenPayError::InvalidConfig);
    }
    let decoded = MirrorPayload::from_xdr(env, &payload)
        .unwrap_or_else(|_| fail(env, ArcenPayError::InvalidConfig));
    apply_mirror_update(
        env,
        &decoded.subscriber,
        decoded.source_token_id,
        decoded.plan_id,
        &decoded.plan_tier,
        decoded.expiration,
        source_chain_id,
        decoded.source_updated_at,
    );
}

#[contract]
pub struct MirrorRegistry;

#[contractimpl]
impl MirrorRegistry {
    pub fn __constructor(env: Env, admin: Address, threshold: u32) {
        if read_initialized(&env) {
            fail(&env, ArcenPayError::AlreadyInitialized);
        }
        write_admin(&env, &admin);
        if threshold < 1 {
            fail(&env, ArcenPayError::InvalidConfig);
        }
        env.storage()
            .instance()
            .set(&DataKey::ValidatorThreshold, &threshold);
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

    pub fn authorize_bridge(env: Env, admin: Address, bridge: Address, source_chain_id: u64) {
        let stored = read_admin(&env);
        if admin != stored {
            fail(&env, ArcenPayError::NotAuthorized);
        }
        admin.require_auth();
        if source_chain_id == 0 {
            fail(&env, ArcenPayError::InvalidConfig);
        }
        env.storage().persistent().set(
            &DataKey::AuthorizedBridge(source_chain_id, bridge.clone()),
            &true,
        );
        BridgeAuthorized {
            bridge,
            source_chain_id,
        }
        .publish(&env);
    }

    pub fn revoke_bridge(env: Env, admin: Address, bridge: Address, source_chain_id: u64) {
        let stored = read_admin(&env);
        if admin != stored {
            fail(&env, ArcenPayError::NotAuthorized);
        }
        admin.require_auth();
        env.storage().persistent().set(
            &DataKey::AuthorizedBridge(source_chain_id, bridge.clone()),
            &false,
        );
        BridgeRevoked {
            bridge,
            source_chain_id,
        }
        .publish(&env);
    }

    pub fn set_axelar_gateway(env: Env, admin: Address, gateway: Address) {
        let stored = read_admin(&env);
        if admin != stored {
            fail(&env, ArcenPayError::NotAuthorized);
        }
        admin.require_auth();
        env.storage()
            .instance()
            .set(&DataKey::AxelarGateway, &gateway);
    }

    pub fn clear_axelar_gateway(env: Env, admin: Address) {
        let stored = read_admin(&env);
        if admin != stored {
            fail(&env, ArcenPayError::NotAuthorized);
        }
        admin.require_auth();
        env.storage().instance().remove(&DataKey::AxelarGateway);
    }

    pub fn set_ccip_router(env: Env, admin: Address, router: Address) {
        let stored = read_admin(&env);
        if admin != stored {
            fail(&env, ArcenPayError::NotAuthorized);
        }
        admin.require_auth();
        env.storage().instance().set(&DataKey::CcipRouter, &router);
    }

    pub fn clear_ccip_router(env: Env, admin: Address) {
        let stored = read_admin(&env);
        if admin != stored {
            fail(&env, ArcenPayError::NotAuthorized);
        }
        admin.require_auth();
        env.storage().instance().remove(&DataKey::CcipRouter);
    }

    pub fn set_trusted_source(
        env: Env,
        admin: Address,
        source_chain_id: u64,
        source_address: BytesN<32>,
    ) {
        let stored = read_admin(&env);
        if admin != stored {
            fail(&env, ArcenPayError::NotAuthorized);
        }
        admin.require_auth();
        if source_chain_id == 0 {
            fail(&env, ArcenPayError::InvalidConfig);
        }
        let hash: BytesN<32> = env
            .crypto()
            .sha256(&soroban_sdk::Bytes::from(&source_address))
            .into();
        env.storage()
            .instance()
            .set(&DataKey::TrustedSource(source_chain_id), &hash);
        TrustedSourceConfigured {
            source_chain_id,
            source_hash: hash,
        }
        .publish(&env);
    }

    pub fn add_validator(env: Env, admin: Address, validator_pubkey: BytesN<32>) {
        let stored = read_admin(&env);
        if admin != stored {
            fail(&env, ArcenPayError::NotAuthorized);
        }
        admin.require_auth();
        env.storage()
            .persistent()
            .set(&DataKey::Validator(validator_pubkey.clone()), &true);
        ValidatorAdded { validator_pubkey }.publish(&env);
    }

    pub fn remove_validator(env: Env, admin: Address, validator_pubkey: BytesN<32>) {
        let stored = read_admin(&env);
        if admin != stored {
            fail(&env, ArcenPayError::NotAuthorized);
        }
        admin.require_auth();
        env.storage()
            .persistent()
            .set(&DataKey::Validator(validator_pubkey.clone()), &false);
        ValidatorRemoved { validator_pubkey }.publish(&env);
    }

    pub fn is_validator(env: Env, validator_pubkey: BytesN<32>) -> bool {
        is_validator(&env, &validator_pubkey)
    }

    pub fn set_threshold(env: Env, admin: Address, threshold: u32) {
        let stored = read_admin(&env);
        if admin != stored {
            fail(&env, ArcenPayError::NotAuthorized);
        }
        admin.require_auth();
        if threshold < 1 {
            fail(&env, ArcenPayError::InvalidConfig);
        }
        env.storage()
            .instance()
            .set(&DataKey::ValidatorThreshold, &threshold);
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
        payload: soroban_sdk::Bytes,
    ) {
        caller.require_auth();
        require_not_paused(&env);
        if !is_authorized_bridge(&env, source_chain_id, &caller) {
            fail(&env, ArcenPayError::NotAuthorized);
        }
        Self::process_routed_message(
            &env,
            0,
            source_chain_id,
            &source_address,
            &message_id,
            &payload,
        );
    }

    pub fn on_axelar_message(
        env: Env,
        caller: Address,
        source_chain_id: u64,
        source_address: BytesN<32>,
        message_id: BytesN<32>,
        payload: soroban_sdk::Bytes,
    ) {
        caller.require_auth();
        require_not_paused(&env);
        let gateway = read_axelar_gateway(&env);
        match gateway {
            Some(g) if g == caller => {}
            _ => fail(&env, ArcenPayError::NotAuthorized),
        }
        Self::process_routed_message(
            &env,
            1,
            source_chain_id,
            &source_address,
            &message_id,
            &payload,
        );
    }

    pub fn on_ccip_message(
        env: Env,
        caller: Address,
        source_chain_id: u64,
        source_address: BytesN<32>,
        message_id: BytesN<32>,
        payload: soroban_sdk::Bytes,
    ) {
        caller.require_auth();
        require_not_paused(&env);
        let router = read_ccip_router(&env);
        match router {
            Some(r) if r == caller => {}
            _ => fail(&env, ArcenPayError::NotAuthorized),
        }
        Self::process_routed_message(
            &env,
            2,
            source_chain_id,
            &source_address,
            &message_id,
            &payload,
        );
    }

    /// Apply a cross-chain update authorized by an m-of-n multi-sig of the
    /// registered validators. Each (public_key, signature) pair is verified
    /// against the canonical signed payload (source_chain_id || source_address
    /// || message_id || payload) using Stellar's native ed25519 verifier.
    ///
    /// NOTE: signature change from the previous `apply_bridge_update_with_signatures`
    /// — the renamed entrypoint `apply_signed_update` now takes paired
    /// `(pubkeys, signatures)` vectors of equal length because ed25519 public
    /// keys are not recoverable from signatures (the previous implementation
    /// used a bogus `recover_validator` that always returned the same address
    /// and silently accepted any input).
    pub fn apply_signed_update(
        env: Env,
        source_chain_id: u64,
        source_address: BytesN<32>,
        message_id: BytesN<32>,
        payload: soroban_sdk::Bytes,
        pubkeys: Vec<BytesN<32>>,
        signatures: Vec<BytesN<64>>,
    ) {
        require_not_paused(&env);

        if pubkeys.len() != signatures.len() {
            fail(&env, ArcenPayError::InvalidSignature);
        }
        if message_processed(&env, &message_id) {
            fail(&env, ArcenPayError::MessageAlreadyProcessed);
        }
        if message_id == BytesN::from_array(&env, &[0u8; 32]) {
            fail(&env, ArcenPayError::InvalidConfig);
        }

        let trusted = trusted_source_hash(&env, source_chain_id);
        if let Some(expected) = trusted {
            let source_hash: BytesN<32> = env
                .crypto()
                .sha256(&soroban_sdk::Bytes::from(&source_address))
                .into();
            if source_hash != expected {
                fail(&env, ArcenPayError::NotAuthorized);
            }
        }

        let threshold = read_validator_threshold(&env);
        if pubkeys.len() < threshold {
            fail(&env, ArcenPayError::ThresholdNotMet);
        }

        // Build the canonical signed message envelope.
        let mut signed = soroban_sdk::Bytes::new(&env);
        signed.append(&source_chain_id_for_hash(&env, &source_chain_id));
        signed.append(&source_address.to_xdr(&env));
        signed.append(&message_id.clone().to_xdr(&env));
        signed.append(&payload.clone().to_xdr(&env));

        let mut unique_validators = 0u32;
        let mut seen: Map<BytesN<32>, bool> = Map::new(&env);

        for i in 0..pubkeys.len() {
            let pk = pubkeys.get(i).unwrap();
            let sig = signatures.get(i).unwrap();
            if !is_validator(&env, &pk) {
                fail(&env, ArcenPayError::InvalidSignature);
            }
            // ed25519_verify panics on invalid signatures (Soroban host).
            env.crypto().ed25519_verify(&pk, &signed, &sig);
            if !seen.contains_key(pk.clone()) {
                seen.set(pk, true);
                unique_validators += 1;
            }
        }

        if unique_validators < threshold {
            fail(&env, ArcenPayError::ThresholdNotMet);
        }

        mark_processed(&env, &message_id);
        let message_id_for_event = message_id.clone();
        decode_and_apply_payload(&env, source_chain_id, payload);

        RoutedMessageProcessed {
            message_id: message_id_for_event,
            route: 0,
        }
        .publish(&env);
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
            None => String::from_str(&env, ""),
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
        payload: &soroban_sdk::Bytes,
    ) {
        if message_processed(env, message_id) {
            fail(env, ArcenPayError::MessageAlreadyProcessed);
        }
        if let Some(expected) = trusted_source_hash(env, source_chain_id) {
            let source_hash: BytesN<32> = env
                .crypto()
                .sha256(&soroban_sdk::Bytes::from(source_address))
                .into();
            if source_hash != expected {
                fail(env, ArcenPayError::NotAuthorized);
            }
        }
        if *message_id == BytesN::from_array(env, &[0u8; 32]) {
            fail(env, ArcenPayError::InvalidConfig);
        }
        mark_processed(env, message_id);
        decode_and_apply_payload(env, source_chain_id, payload.clone());
        RoutedMessageProcessed {
            message_id: message_id.clone(),
            route,
        }
        .publish(env);
    }
}
