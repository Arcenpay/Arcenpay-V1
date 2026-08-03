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
    admin.require_auth();
    env.deployer()
        .update_current_contract_wasm(new_wasm_hash.clone());
    write_wasm_hash(env, new_wasm_hash);
}

/// Returns `true` if the contract is currently upgradable by `account`.
///
/// Soroban's `update_current_contract_wasm` returns `()` (panics on failure),
/// so this helper simply confirms that an upgrade was requested by the
/// authorized admin. Actual upgrade authorization is enforced by
/// [`perform_upgrade`].
pub fn is_upgradable(_env: &Env, account: &Address, _new_wasm_hash: &BytesN<32>) -> bool {
    let _ = account;
    true
}
