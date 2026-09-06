#![no_std]
#![allow(clippy::too_many_arguments)]

extern crate alloc;

use arcenpay_common::{
    auth::*,
    errors::{ArcenPayError, fail},
    token::sac_transfer,
    types::*,
};
use soroban_sdk::{
    Address, BytesN, Env, Vec, contract, contractevent, contractimpl, contracttype, xdr::ToXdr,
};

#[contracttype]
enum DataKey {
    Admin,
    Paused,
    Session(BytesN<32>),
    AgentSessions(Address),
    NextNonce,
    AuthorizedSettler(Address),
    WhitelistedProvider(Address),
    ProviderWhitelistEnabled,
}

#[contractevent]
pub struct SessionFunded {
    #[topic]
    pub agent: Address,
    pub session_id: BytesN<32>,
    pub amount: i128,
    pub token: Address,
}

#[contractevent]
pub struct SessionSettled {
    #[topic]
    pub session_id: BytesN<32>,
    pub amount: i128,
    pub provider: Address,
}

#[contractevent]
pub struct SessionWithdrawn {
    #[topic]
    pub session_id: BytesN<32>,
    pub amount: i128,
    pub agent: Address,
}

#[contractevent]
pub struct SettlerAuthorized {
    pub settler: Address,
}

#[contractevent]
pub struct SettlerRevoked {
    pub settler: Address,
}

#[contractevent]
pub struct ProviderWhitelistConfigured {
    pub enabled: bool,
}

#[contractevent]
pub struct ProviderWhitelisted {
    pub provider: Address,
}

#[contractevent]
pub struct ProviderRemovedFromWhitelist {
    pub provider: Address,
}

fn read_session(env: &Env, session_id: &BytesN<32>) -> SessionRecord {
    env.storage()
        .persistent()
        .get(&DataKey::Session(session_id.clone()))
        .unwrap_or_else(|| fail(env, ArcenPayError::NotFound))
}

fn write_session(env: &Env, session_id: &BytesN<32>, session: &SessionRecord) {
    env.storage()
        .persistent()
        .set(&DataKey::Session(session_id.clone()), session);
}

fn is_settler(env: &Env, settler: &Address) -> bool {
    env.storage()
        .persistent()
        .get(&DataKey::AuthorizedSettler(settler.clone()))
        .unwrap_or(false)
}

fn require_settler(env: &Env, caller: &Address) {
    if !is_settler(env, caller) {
        fail(env, ArcenPayError::UnauthorizedSettler);
    }
}

fn is_whitelisted_provider(env: &Env, provider: &Address) -> bool {
    env.storage()
        .persistent()
        .get(&DataKey::WhitelistedProvider(provider.clone()))
        .unwrap_or(false)
}

fn provider_whitelist_enabled(env: &Env) -> bool {
    env.storage()
        .instance()
        .get(&DataKey::ProviderWhitelistEnabled)
        .unwrap_or(false)
}

fn generate_session_id(env: &Env, agent: &Address, amount: i128, token: &Address) -> BytesN<32> {
    let nonce: u64 = env
        .storage()
        .instance()
        .get(&DataKey::NextNonce)
        .unwrap_or(0);

    let mut input = soroban_sdk::Bytes::new(env);
    input.append(&agent.to_xdr(env));
    input.append(&amount.to_xdr(env));
    input.append(&token.to_xdr(env));
    input.append(&nonce.to_xdr(env));
    input.append(&env.ledger().timestamp().to_xdr(env));
    input.append(&env.ledger().sequence().to_xdr(env));
    let bytes = input;

    let hash: BytesN<32> = env.crypto().sha256(&bytes).into();
    env.storage()
        .instance()
        .set(&DataKey::NextNonce, &(nonce.wrapping_add(1)));
    hash
}

#[contract]
pub struct SessionVault;

#[contractimpl]
impl SessionVault {
    pub fn __constructor(env: Env, admin: Address) {
        if read_initialized(&env) {
            fail(&env, ArcenPayError::AlreadyInitialized);
        }
        write_admin(&env, &admin);
        env.storage().instance().set(&DataKey::NextNonce, &0u64);
        env.storage()
            .instance()
            .set(&DataKey::ProviderWhitelistEnabled, &false);
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
        current.require_auth();
        if new_admin == current {
            fail(&env, ArcenPayError::InvalidAddress);
        }
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

    pub fn authorize_settler(env: Env, admin: Address, settler: Address) {
        let stored = read_admin(&env);
        if admin != stored {
            fail(&env, ArcenPayError::NotAuthorized);
        }
        admin.require_auth();
        env.storage()
            .persistent()
            .set(&DataKey::AuthorizedSettler(settler.clone()), &true);
        SettlerAuthorized { settler }.publish(&env);
    }

    pub fn revoke_settler(env: Env, admin: Address, settler: Address) {
        let stored = read_admin(&env);
        if admin != stored {
            fail(&env, ArcenPayError::NotAuthorized);
        }
        admin.require_auth();
        env.storage()
            .persistent()
            .set(&DataKey::AuthorizedSettler(settler.clone()), &false);
        SettlerRevoked { settler }.publish(&env);
    }

    pub fn set_provider_whitelist_enabled(env: Env, admin: Address, enabled: bool) {
        let stored = read_admin(&env);
        if admin != stored {
            fail(&env, ArcenPayError::NotAuthorized);
        }
        admin.require_auth();
        env.storage()
            .instance()
            .set(&DataKey::ProviderWhitelistEnabled, &enabled);
        ProviderWhitelistConfigured { enabled }.publish(&env);
    }

    pub fn whitelist_provider(env: Env, admin: Address, provider: Address) {
        let stored = read_admin(&env);
        if admin != stored {
            fail(&env, ArcenPayError::NotAuthorized);
        }
        admin.require_auth();
        env.storage()
            .persistent()
            .set(&DataKey::WhitelistedProvider(provider.clone()), &true);
        ProviderWhitelisted { provider }.publish(&env);
    }

    pub fn remove_provider_from_whitelist(env: Env, admin: Address, provider: Address) {
        let stored = read_admin(&env);
        if admin != stored {
            fail(&env, ArcenPayError::NotAuthorized);
        }
        admin.require_auth();
        env.storage()
            .persistent()
            .set(&DataKey::WhitelistedProvider(provider.clone()), &false);
        ProviderRemovedFromWhitelist { provider }.publish(&env);
    }

    pub fn fund_session(env: Env, agent: Address, amount: i128, token: Address) -> BytesN<32> {
        agent.require_auth();
        require_not_paused(&env);
        if amount <= 0 {
            fail(&env, ArcenPayError::InvalidAmount);
        }

        let session_id = generate_session_id(&env, &agent, amount, &token);

        // Check for collision BEFORE moving tokens so a collision never
        // silently seizes the agent's deposit.
        if env
            .storage()
            .persistent()
            .has(&DataKey::Session(session_id.clone()))
        {
            fail(&env, ArcenPayError::AlreadyExists);
        }

        let contract = env.current_contract_address();
        sac_transfer(&env, &token, &agent, &contract, amount);

        let now = env.ledger().timestamp();
        let session = SessionRecord {
            session_id: session_id.clone(),
            agent: agent.clone(),
            token: token.clone(),
            balance: amount,
            total_funded: amount,
            total_settled: 0,
            active: true,
            created_at: now,
        };

        write_session(&env, &session_id, &session);

        let mut agent_sessions: Vec<BytesN<32>> = env
            .storage()
            .persistent()
            .get(&DataKey::AgentSessions(agent.clone()))
            .unwrap_or(Vec::new(&env));
        agent_sessions.push_back(session_id.clone());
        env.storage()
            .persistent()
            .set(&DataKey::AgentSessions(agent.clone()), &agent_sessions);

        SessionFunded {
            agent,
            session_id: session_id.clone(),
            amount,
            token,
        }
        .publish(&env);

        session_id
    }

    pub fn top_up(env: Env, agent: Address, session_id: BytesN<32>, amount: i128) {
        agent.require_auth();
        require_not_paused(&env);
        if amount <= 0 {
            fail(&env, ArcenPayError::InvalidAmount);
        }

        let mut session = read_session(&env, &session_id);
        if session.agent != agent {
            fail(&env, ArcenPayError::NotOwner);
        }
        if !session.active {
            fail(&env, ArcenPayError::SubscriptionNotActive);
        }

        let contract = env.current_contract_address();
        sac_transfer(&env, &session.token, &agent, &contract, amount);

        session.balance += amount;
        session.total_funded += amount;
        write_session(&env, &session_id, &session);

        SessionFunded {
            agent: agent.clone(),
            session_id: session_id.clone(),
            amount,
            token: session.token.clone(),
        }
        .publish(&env);
    }

    pub fn settle(
        env: Env,
        settler: Address,
        session_id: BytesN<32>,
        amount: i128,
        provider: Address,
    ) {
        settler.require_auth();
        require_settler(&env, &settler);
        require_not_paused(&env);
        if amount <= 0 {
            fail(&env, ArcenPayError::InvalidAmount);
        }

        let mut session = read_session(&env, &session_id);
        if !session.active {
            fail(&env, ArcenPayError::SubscriptionNotActive);
        }
        if session.balance < amount {
            fail(&env, ArcenPayError::InsufficientBalance);
        }

        if provider_whitelist_enabled(&env) && !is_whitelisted_provider(&env, &provider) {
            fail(&env, ArcenPayError::ProviderWhitelistRequired);
        }

        // Effects before interaction (CEI): update state, then transfer out.
        session.balance -= amount;
        session.total_settled += amount;
        if session.balance == 0 {
            session.active = false;
        }
        write_session(&env, &session_id, &session);

        sac_transfer(
            &env,
            &session.token,
            &env.current_contract_address(),
            &provider,
            amount,
        );

        SessionSettled {
            session_id,
            amount,
            provider,
        }
        .publish(&env);
    }

    pub fn withdraw(env: Env, agent: Address, session_id: BytesN<32>) -> i128 {
        agent.require_auth();
        require_not_paused(&env);

        let mut session = read_session(&env, &session_id);
        if session.agent != agent {
            fail(&env, ArcenPayError::NotOwner);
        }
        if !session.active {
            fail(&env, ArcenPayError::SubscriptionNotActive);
        }

        let remaining = session.balance;
        if remaining <= 0 {
            fail(&env, ArcenPayError::InsufficientBalance);
        }

        // CEI: zero balance and mark inactive before transferring out.
        session.balance = 0;
        session.active = false;
        write_session(&env, &session_id, &session);

        let contract = env.current_contract_address();
        sac_transfer(&env, &session.token, &contract, &agent, remaining);

        SessionWithdrawn {
            session_id,
            amount: remaining,
            agent,
        }
        .publish(&env);

        remaining
    }

    pub fn get_balance(env: Env, session_id: BytesN<32>) -> i128 {
        let session: Option<SessionRecord> = env
            .storage()
            .persistent()
            .get(&DataKey::Session(session_id));
        match session {
            Some(s) => s.balance,
            None => 0,
        }
    }

    pub fn get_agent_balance(env: Env, agent: Address) -> i128 {
        let sessions: Vec<BytesN<32>> = env
            .storage()
            .persistent()
            .get(&DataKey::AgentSessions(agent.clone()))
            .unwrap_or(Vec::new(&env));
        let mut total: i128 = 0;
        for i in 0..sessions.len() {
            let sid = sessions.get(i).unwrap();
            let session = read_session(&env, &sid);
            if session.active {
                total += session.balance;
            }
        }
        total
    }

    pub fn get_session(env: Env, session_id: BytesN<32>) -> SessionRecord {
        read_session(&env, &session_id)
    }

    pub fn get_agent_sessions(env: Env, agent: Address) -> Vec<BytesN<32>> {
        env.storage()
            .persistent()
            .get(&DataKey::AgentSessions(agent))
            .unwrap_or(Vec::new(&env))
    }

    pub fn has_session(env: Env, session_id: BytesN<32>) -> bool {
        env.storage()
            .persistent()
            .has(&DataKey::Session(session_id))
    }
}
