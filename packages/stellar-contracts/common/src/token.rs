use soroban_sdk::{Address, Env, token};

pub const SAC_IDENTIFIER: soroban_sdk::Symbol = soroban_sdk::symbol_short!("SAC");

pub fn get_token_client<'a>(env: &'a Env, token_address: &Address) -> token::Client<'a> {
    token::Client::new(env, token_address)
}

pub fn get_stellar_asset_client<'a>(
    env: &'a Env,
    token_address: &Address,
) -> token::StellarAssetClient<'a> {
    token::StellarAssetClient::new(env, token_address)
}

pub fn sac_balance(env: &Env, token: &Address, account: &Address) -> i128 {
    let client = get_token_client(env, token);
    client.balance(account)
}

pub fn sac_transfer(env: &Env, token: &Address, from: &Address, to: &Address, amount: i128) {
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

pub fn token_identifier(env: &Env, token: &Address) -> soroban_sdk::String {
    let client = get_token_client(env, token);
    client.symbol()
}

pub fn get_usdc_client<'a>(env: &'a Env, usdc_address: &Address) -> token::Client<'a> {
    get_token_client(env, usdc_address)
}

pub fn get_usdc_sac_client<'a>(
    env: &'a Env,
    usdc_address: &Address,
) -> token::StellarAssetClient<'a> {
    get_stellar_asset_client(env, usdc_address)
}
