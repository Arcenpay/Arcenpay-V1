#![cfg(test)]

use soroban_sdk::{testutils::Address as _, Address, Env, BytesN, String};

use crate::{FlagRegistry, FlagRegistryClient};

#[test]
fn test_constructor() {
    let env = Env::default();
    let admin = Address::generate(&env);

    let contract_id = env.register(FlagRegistry, (admin.clone(),));
    let client = FlagRegistryClient::new(&env, &contract_id);

    assert_eq!(client.owner(), admin);
    assert_eq!(client.version(), 1);
}

#[test]
fn test_set_and_get_flag() {
    let env = Env::default();
    let admin = Address::generate(&env);

    let contract_id = env.register(FlagRegistry, (admin.clone(),));
    let client = FlagRegistryClient::new(&env, &contract_id);

    let team_id: BytesN<32> = soroban_sdk::bytesn!(&env, 0x0102030405060708090a0b0c0d0e0f101112131415161718191a1b1c1d1e1f20);
    let feature_key = String::from_slice(&env, "dark_mode");

    client.set_flag(&admin, &team_id, &feature_key, &true);
    let (value, exists) = client.get_flag(&team_id, &feature_key);
    assert!(exists);
    assert!(value);

    let count = client.get_flag_count(&team_id);
    assert_eq!(count, 1);
}

#[test]
fn test_set_flag_idempotent() {
    let env = Env::default();
    let admin = Address::generate(&env);

    let contract_id = env.register(FlagRegistry, (admin.clone(),));
    let client = FlagRegistryClient::new(&env, &contract_id);

    let team_id: BytesN<32> = soroban_sdk::bytesn!(&env, 0x0102030405060708090a0b0c0d0e0f101112131415161718191a1b1c1d1e1f20);
    let feature_key = String::from_slice(&env, "analytics");

    client.set_flag(&admin, &team_id, &feature_key, &true);
    client.set_flag(&admin, &team_id, &feature_key, &true);

    let (value, exists) = client.get_flag(&team_id, &feature_key);
    assert!(exists);
    assert!(value);

    let count = client.get_flag_count(&team_id);
    assert_eq!(count, 1);
}

#[test]
fn test_set_flags_batch() {
    let env = Env::default();
    let admin = Address::generate(&env);

    let contract_id = env.register(FlagRegistry, (admin.clone(),));
    let client = FlagRegistryClient::new(&env, &contract_id);

    let team_id: BytesN<32> = soroban_sdk::bytesn!(&env, 0x0102030405060708090a0b0c0d0e0f101112131415161718191a1b1c1d1e1f20);

    let keys = soroban_sdk::vec![
        &env,
        String::from_slice(&env, "feature_a"),
        String::from_slice(&env, "feature_b"),
        String::from_slice(&env, "feature_c"),
    ];
    let values = soroban_sdk::vec![&env, true, false, true];

    client.set_flags(&admin, &team_id, &keys, &values);

    let (v1, e1) = client.get_flag(&team_id, &String::from_slice(&env, "feature_a"));
    assert!(e1 && v1);
    let (v2, e2) = client.get_flag(&team_id, &String::from_slice(&env, "feature_b"));
    assert!(e2 && !v2);
    let (v3, e3) = client.get_flag(&team_id, &String::from_slice(&env, "feature_c"));
    assert!(e3 && v3);

    let count = client.get_flag_count(&team_id);
    assert_eq!(count, 3);

    let flag_keys = client.get_flag_keys(&team_id);
    assert_eq!(flag_keys.len(), 3);
}

#[test]
fn test_operator_authorization() {
    let env = Env::default();
    let admin = Address::generate(&env);
    let operator = Address::generate(&env);

    let contract_id = env.register(FlagRegistry, (admin.clone(),));
    let client = FlagRegistryClient::new(&env, &contract_id);

    let team_id: BytesN<32> = soroban_sdk::bytesn!(&env, 0x0102030405060708090a0b0c0d0e0f101112131415161718191a1b1c1d1e1f20);

    assert!(!client.is_operator(&team_id, &operator));
    client.authorize_operator(&admin, &team_id, &operator);
    assert!(client.is_operator(&team_id, &operator));

    client.revoke_operator(&admin, &team_id, &operator);
    assert!(!client.is_operator(&team_id, &operator));
}

#[test]
fn test_operator_can_set_flags() {
    let env = Env::default();
    let admin = Address::generate(&env);
    let operator = Address::generate(&env);

    let contract_id = env.register(FlagRegistry, (admin.clone(),));
    let client = FlagRegistryClient::new(&env, &contract_id);

    let team_id: BytesN<32> = soroban_sdk::bytesn!(&env, 0x0102030405060708090a0b0c0d0e0f101112131415161718191a1b1c1d1e1f20);
    let feature_key = String::from_slice(&env, "operator_test");

    client.authorize_operator(&admin, &team_id, &operator);
    client.set_flag(&operator, &team_id, &feature_key, &true);

    let (value, exists) = client.get_flag(&team_id, &feature_key);
    assert!(exists);
    assert!(value);
}

#[test]
fn test_flag_update_value() {
    let env = Env::default();
    let admin = Address::generate(&env);

    let contract_id = env.register(FlagRegistry, (admin.clone(),));
    let client = FlagRegistryClient::new(&env, &contract_id);

    let team_id: BytesN<32> = soroban_sdk::bytesn!(&env, 0x0102030405060708090a0b0c0d0e0f101112131415161718191a1b1c1d1e1f20);
    let feature_key = String::from_slice(&env, "toggle");

    client.set_flag(&admin, &team_id, &feature_key, &true);
    let (v1, _) = client.get_flag(&team_id, &feature_key);
    assert!(v1);

    client.set_flag(&admin, &team_id, &feature_key, &false);
    let (v2, _) = client.get_flag(&team_id, &feature_key);
    assert!(!v2);
}

#[test]
fn test_feature_key_length_limit() {
    let env = Env::default();
    let admin = Address::generate(&env);

    let contract_id = env.register(FlagRegistry, (admin.clone(),));
    let client = FlagRegistryClient::new(&env, &contract_id);

    let team_id: BytesN<32> = soroban_sdk::bytesn!(&env, 0x0102030405060708090a0b0c0d0e0f101112131415161718191a1b1c1d1e1f20);
    let long_key = String::from_slice(&env, &"x".repeat(65));
    let short_key = String::from_slice(&env, "ok");

    assert!(std::panic::catch_unwind(|| {
        client.set_flag(&admin, &team_id, &long_key, &true);
    })
    .is_err());

    client.set_flag(&admin, &team_id, &short_key, &true);
    let (value, _) = client.get_flag(&team_id, &short_key);
    assert!(value);
}
