use soroban_sdk::{Address, BytesN, Env, symbol_short};

pub const VERSION: u32 = 1;

pub fn version() -> u32 {
    VERSION
}

pub fn read_wasm_hash(env: &Env) -> Option<BytesN<32>> {
    env.storage().instance().get(&symbol_short!("WASM_HASH"))
}

pub fn write_wasm_hash(env: &Env, hash: &BytesN<32>) {
    env.storage()
        .instance()
        .set(&symbol_short!("WASM_HASH"), hash);
}

pub fn perform_upgrade(env: &Env, admin: &Address, new_wasm_hash: &BytesN<32>) {
    let stored_admin = crate::auth::read_admin(env);
    if admin != &stored_admin {
        crate::errors::fail(env, crate::errors::ArcenPayError::NotAuthorized);
    }
    admin.require_auth();
    env.deployer()
        .update_current_contract_wasm(new_wasm_hash.clone());
    write_wasm_hash(env, new_wasm_hash);
}

/// Returns `true` if the contract is currently upgradable by `account`.
///
/// Confirms that the caller matches the stored contract admin configured in
/// [`crate::auth::CommonDataKey::Admin`].
pub fn is_upgradable(env: &Env, account: &Address, _new_wasm_hash: &BytesN<32>) -> bool {
    match env
        .storage()
        .instance()
        .get::<_, Address>(&crate::auth::CommonDataKey::Admin)
    {
        Some(admin) => &admin == account,
        None => false,
    }
}
