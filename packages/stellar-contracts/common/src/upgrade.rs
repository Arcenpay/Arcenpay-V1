use soroban_sdk::{Address, Env, BytesN, symbol_short};

pub const VERSION: u32 = 1;

pub fn version() -> u32 {
    VERSION
}

pub fn read_wasm_hash(env: &Env) -> Option<BytesN<32>> {
    env.storage().instance().get(&symbol_short!("WASM_HASH"))
}

pub fn write_wasm_hash(env: &Env, hash: &BytesN<32>) {
    env.storage().instance().set(&symbol_short!("WASM_HASH"), hash);
}

pub fn perform_upgrade(env: &Env, admin: &Address, new_wasm_hash: &BytesN<32>) {
    admin.require_auth();
    env.deployer().update_current_contract_wasm(new_wasm_hash.clone());
    write_wasm_hash(env, new_wasm_hash);
}

pub fn is_upgradable(env: &Env, account: &Address, new_wasm_hash: &BytesN<32>) -> bool {
    match env.deployer().update_current_contract_wasm(new_wasm_hash.clone()) {
        Ok(_) => true,
        Err(_) => false,
    }
}
