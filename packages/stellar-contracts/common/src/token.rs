use soroban_sdk::{Address, Env, IntoVal, Symbol, symbol_short, token};

pub const SAC_IDENTIFIER: Symbol = symbol_short!("SAC");

pub fn get_token_client(env: &Env, token_address: &Address) -> token::Client {
    token::Client::new(env, token_address)
}

pub fn get_stellar_asset_client(env: &Env, token_address: &Address) -> token::StellarAssetClient {
    token::StellarAssetClient::new(env, token_address)
}

pub fn sac_balance(env: &Env, token: &Address, account: &Address) -> i128 {
    let client = get_token_client(env, token);
    client.balance(account)
}

pub fn sac_transfer(
    env: &Env,
    token: &Address,
    from: &Address,
    to: &Address,
    amount: i128,
) {
    from.require_auth();
    let client = get_token_client(env, token);
    client.transfer(from, to, &amount);
}

pub fn sac_transfer_from(
    env: &Env,
    token: &Address,
    spender: &Address,
    from: &Address,
    to: &Address,
    amount: i128,
) {
    spender.require_auth();
    let client = get_token_client(env, token);
    client.transfer_from(spender, from, to, &amount);
}

pub fn sac_approve(
    env: &Env,
    token: &Address,
    from: &Address,
    spender: &Address,
    amount: i128,
    live_until_ledger: u32,
) {
    from.require_auth();
    let client = get_token_client(env, token);
    client.approve(from, spender, &amount, &live_until_ledger);
}

pub fn token_identifier(env: &Env, token: &Address) -> Symbol {
    let client = get_token_client(env, token);
    client.symbol()
}

pub fn get_usdc_client(env: &Env, usdc_address: &Address) -> token::Client {
    get_token_client(env, usdc_address)
}

pub fn get_usdc_sac_client(env: &Env, usdc_address: &Address) -> token::StellarAssetClient {
    get_stellar_asset_client(env, usdc_address)
}
