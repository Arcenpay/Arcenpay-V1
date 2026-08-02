#![no_std]

use soroban_sdk::{contract, contractimpl, contracttype, Address, Env, Vec, BytesN, String, Map};
use arcenpay_common::{auth::*, errors::ArcenPayError, types::FlagEntryRecord};

#[cfg(test)]
mod tests;

#[contracttype]
#[derive(Clone)]
pub struct FlagKey {
    pub team_id: BytesN<32>,
    pub feature_key: String,
}

#[contracttype]
enum DataKey {
    Owner,
    Flag(FlagKey),
    FlagKeys(BytesN<32>),
    Operator(BytesN<32>, Address),
}

#[contractevent]
pub struct FlagRegistered {
    #[topic]
    pub team_id: BytesN<32>,
    pub feature_key: String,
    pub default_value: bool,
}

#[contractevent]
pub struct FlagUpdated {
    #[topic]
    pub team_id: BytesN<32>,
    pub feature_key: String,
    pub old_value: bool,
    pub new_value: bool,
}

#[contractevent]
pub struct OperatorAuthorized {
    #[topic]
    pub team_id: BytesN<32>,
    pub operator: Address,
}

#[contractevent]
pub struct OperatorRevoked {
    #[topic]
    pub team_id: BytesN<32>,
    pub operator: Address,
}

#[contract]
pub struct FlagRegistry;

#[contractimpl]
impl FlagRegistry {
    pub fn __constructor(env: Env, owner: Address) {
        assert!(!read_initialized(&env), "Already initialized");
        env.storage().instance().set(&DataKey::Owner, &owner);
        write_initialized(&env);
    }

    pub fn version() -> u32 {
        1
    }

    pub fn owner(env: Env) -> Address {
        env.storage().instance().get(&DataKey::Owner).unwrap()
    }

    pub fn transfer_ownership(env: Env, new_owner: Address) {
        let current: Address = env.storage().instance().get(&DataKey::Owner).unwrap();
        current.require_auth();
        assert_ne!(new_owner, current);
        env.storage().instance().set(&DataKey::Owner, &new_owner);
    }

    pub fn is_operator(env: Env, team_id: BytesN<32>, operator: Address) -> bool {
        let key = DataKey::Operator(team_id.clone(), operator);
        env.storage().persistent().get(&key).unwrap_or(false)
    }

    pub fn authorize_operator(env: Env, owner: Address, team_id: BytesN<32>, operator: Address) {
        let stored_owner: Address = env.storage().instance().get(&DataKey::Owner).unwrap();
        assert_eq!(owner, stored_owner);
        owner.require_auth();
        let key = DataKey::Operator(team_id.clone(), operator.clone());
        env.storage().persistent().set(&key, &true);
        OperatorAuthorized { team_id, operator }.publish(&env);
    }

    pub fn revoke_operator(env: Env, owner: Address, team_id: BytesN<32>, operator: Address) {
        let stored_owner: Address = env.storage().instance().get(&DataKey::Owner).unwrap();
        assert_eq!(owner, stored_owner);
        owner.require_auth();
        let key = DataKey::Operator(team_id.clone(), operator.clone());
        env.storage().persistent().set(&key, &false);
        OperatorRevoked { team_id, operator }.publish(&env);
    }

    fn check_operator_or_owner(env: &Env, team_id: &BytesN<32>, caller: &Address) {
        let owner: Address = env.storage().instance().get(&DataKey::Owner).unwrap();
        if caller == &owner {
            return;
        }
        let op_key = DataKey::Operator(team_id.clone(), caller.clone());
        let is_op: bool = env.storage().persistent().get(&op_key).unwrap_or(false);
        assert!(is_op, "Not authorized to manage flags for this team");
    }

    pub fn set_flag(
        env: Env,
        caller: Address,
        team_id: BytesN<32>,
        feature_key: String,
        default_value: bool,
    ) {
        caller.require_auth();
        Self::check_operator_or_owner(&env, &team_id, &caller);
        assert!(!feature_key.is_empty(), "Feature key must not be empty");
        assert!(feature_key.len() <= 64, "Feature key max 64 chars");

        let flag_persistent_key = DataKey::Flag(FlagKey { team_id: team_id.clone(), feature_key: feature_key.clone() });

        let existing: Option<FlagEntryRecord> = env.storage().persistent().get(&flag_persistent_key);
        let now = env.ledger().timestamp();

        match existing {
            Some(entry) => {
                let old_value = entry.default_value;
                if old_value == default_value {
                    return;
                }
                let updated = FlagEntryRecord {
                    default_value,
                    updated_at: now,
                    exists: true,
                    ..entry
                };
                env.storage().persistent().set(&flag_persistent_key, &updated);
                FlagUpdated {
                    team_id: team_id.clone(),
                    feature_key: feature_key.clone(),
                    old_value,
                    new_value: default_value,
                }
                .publish(&env);
            }
            None => {
                let entry = FlagEntryRecord {
                    team_id: team_id.clone(),
                    feature_key: feature_key.clone(),
                    default_value,
                    exists: true,
                    created_at: now,
                    updated_at: now,
                };
                env.storage().persistent().set(&flag_persistent_key, &entry);

                let mut keys: Vec<String> = env
                    .storage()
                    .persistent()
                    .get(&DataKey::FlagKeys(team_id.clone()))
                    .unwrap_or(Vec::new(&env));
                keys.push_back(feature_key.clone());
                env.storage()
                    .persistent()
                    .set(&DataKey::FlagKeys(team_id.clone()), &keys);

                FlagRegistered {
                    team_id,
                    feature_key,
                    default_value,
                }
                .publish(&env);
            }
        }
    }

    pub fn set_flags(
        env: Env,
        caller: Address,
        team_id: BytesN<32>,
        feature_keys: Vec<String>,
        default_values: Vec<bool>,
    ) {
        assert_eq!(
            feature_keys.len(),
            default_values.len(),
            "Keys and values length mismatch"
        );
        caller.require_auth();
        Self::check_operator_or_owner(&env, &team_id, &caller);

        for i in 0..feature_keys.len() {
            let key = feature_keys.get(i).unwrap();
            let val = default_values.get(i).unwrap();
            Self::set_flag(
                env.clone(),
                caller.clone(),
                team_id.clone(),
                key,
                val,
            );
        }
    }

    pub fn get_flag(env: Env, team_id: BytesN<32>, feature_key: String) -> (bool, bool) {
        let key = DataKey::Flag(Self::build_flag_key(&team_id, &feature_key));
        let entry: Option<FlagEntryRecord> = env.storage().persistent().get(&key);
        match entry {
            Some(e) => (e.default_value, e.exists),
            None => (false, false),
        }
    }

    pub fn get_flag_keys(env: Env, team_id: BytesN<32>) -> Vec<String> {
        env.storage()
            .persistent()
            .get(&DataKey::FlagKeys(team_id))
            .unwrap_or(Vec::new(&env))
    }

    pub fn get_flag_entry(
        env: Env,
        team_id: BytesN<32>,
        feature_key: String,
    ) -> Option<FlagEntryRecord> {
        let key = DataKey::Flag(Self::build_flag_key(&team_id, &feature_key));
        env.storage().persistent().get(&key)
    }

    pub fn get_flag_count(env: Env, team_id: BytesN<32>) -> u32 {
        let keys: Vec<String> = env
            .storage()
            .persistent()
            .get(&DataKey::FlagKeys(team_id))
            .unwrap_or(Vec::new(&env));
        keys.len()
    }
}
