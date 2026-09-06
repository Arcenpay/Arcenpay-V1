use soroban_sdk::{Address, Env};

use crate::errors::{ArcenPayError, fail};

#[derive(Clone)]
#[soroban_sdk::contracttype]
pub enum CommonDataKey {
    Admin,
    Paused,
    Initialized,
    Version,
    AuthNonce(Address),
    ReentrancyLock,
}

pub fn read_admin(env: &Env) -> Address {
    env.storage()
        .instance()
        .get(&CommonDataKey::Admin)
        .unwrap_or_else(|| fail(env, ArcenPayError::NotInitialized))
}

pub fn write_admin(env: &Env, admin: &Address) {
    env.storage().instance().set(&CommonDataKey::Admin, admin);
}

pub fn require_admin(env: &Env) -> Address {
    let admin = read_admin(env);
    admin.require_auth();
    admin
}

pub fn read_paused(env: &Env) -> bool {
    env.storage()
        .instance()
        .get(&CommonDataKey::Paused)
        .unwrap_or(false)
}

pub fn write_paused(env: &Env, paused: bool) {
    env.storage()
        .instance()
        .set(&CommonDataKey::Paused, &paused);
}

pub fn require_not_paused(env: &Env) {
    if read_paused(env) {
        fail(env, ArcenPayError::ContractPaused);
    }
}

pub fn read_initialized(env: &Env) -> bool {
    env.storage()
        .instance()
        .get(&CommonDataKey::Initialized)
        .unwrap_or(false)
}

pub fn write_initialized(env: &Env) {
    env.storage()
        .instance()
        .set(&CommonDataKey::Initialized, &true);
}

pub fn read_version(env: &Env) -> u32 {
    env.storage()
        .instance()
        .get(&CommonDataKey::Version)
        .unwrap_or(0)
}

pub fn write_version(env: &Env, version: u32) {
    env.storage()
        .instance()
        .set(&CommonDataKey::Version, &version);
}

pub fn acquire_reentrancy_lock(env: &Env) -> bool {
    let locked: bool = env
        .storage()
        .instance()
        .get(&CommonDataKey::ReentrancyLock)
        .unwrap_or(false);
    if locked {
        return false;
    }
    env.storage()
        .instance()
        .set(&CommonDataKey::ReentrancyLock, &true);
    true
}

pub fn release_reentrancy_lock(env: &Env) {
    env.storage()
        .instance()
        .set(&CommonDataKey::ReentrancyLock, &false);
}

pub fn nonce_consumed(env: &Env, addr: &Address, nonce: u64) -> bool {
    let key = CommonDataKey::AuthNonce(addr.clone());
    let last: u64 = env.storage().persistent().get(&key).unwrap_or(0);
    if nonce <= last {
        return true;
    }
    env.storage().persistent().set(&key, &nonce);
    false
}
