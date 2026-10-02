// ============================================================
//  ArcenPay Solana program — lifecycle integration test
//
//  Runs the program natively via solana-program-test (no validator)
//  and WARPS THE CLOCK forward to exercise the positive renewal
//  (`execute`) path, which the localnet smoke cannot reach because
//  MIN_BILLING_INTERVAL is 30 days.
//
//  Instructions are hand-encoded with the Anchor discriminators
//  (sha256("global:<name>")[0..8]) so the test does not depend on the
//  generated builder module. These are the SAME discriminators the
//  facilitator's solana-instruction-codec.ts produces.
// ============================================================

use anchor_lang::AccountDeserialize;
use arcenpay_solana::{Config, Plan, Session, Subscription, ID};
use solana_program_test::{processor, ProgramTest, ProgramTestContext};
use solana_sdk::{
    account::Account,
    account_info::AccountInfo,
    entrypoint::ProgramResult,
    instruction::{AccountMeta, Instruction},
    program_pack::Pack,
    pubkey::Pubkey,
    signature::{Keypair, Signer},
    system_program,
    transaction::Transaction,
};
use spl_token::state::{Account as TokenAccount, AccountState, Mint};

const DECIMALS: u8 = 6;
const PRICE: u64 = 10_000_000; // 10 USDC
const FEE_BPS: u64 = 50;
const INTERVAL: i64 = 2_592_000; // 30 days

const DISC_INITIALIZE_CONFIG: [u8; 8] = [208, 127, 21, 1, 194, 190, 196, 70];
const DISC_CREATE_PLAN: [u8; 8] = [77, 43, 141, 254, 212, 118, 41, 186];
const DISC_SUBSCRIBE: [u8; 8] = [254, 28, 191, 138, 156, 179, 183, 53];
const DISC_EXECUTE: [u8; 8] = [130, 221, 242, 154, 13, 193, 189, 29];
const DISC_CANCEL: [u8; 8] = [232, 219, 223, 41, 219, 236, 220, 190];
const DISC_CHANGE_PLAN: [u8; 8] = [75, 206, 141, 79, 34, 245, 125, 189];
const DISC_REAUTHORIZE_AUTOPAY: [u8; 8] = [75, 224, 241, 210, 10, 248, 52, 186];
const DISC_AUTHORIZE_SETTLER: [u8; 8] = [194, 185, 224, 99, 141, 104, 196, 21];
const DISC_FUND_SESSION: [u8; 8] = [40, 175, 120, 162, 32, 100, 32, 38];
const DISC_SETTLE: [u8; 8] = [175, 42, 185, 87, 144, 131, 102, 212];
const DISC_WITHDRAW_SESSION: [u8; 8] = [214, 122, 170, 234, 173, 91, 44, 254];
const DISC_SET_PROOF_VERIFICATION: [u8; 8] = [179, 12, 66, 132, 68, 102, 186, 164];

/// Adapter so `processor!` can wrap Anchor's entrypoint.
///
/// `processor!` requires a `for<'a,'b,'c> fn(&'a Pubkey, &'b [AccountInfo<'c>],
/// &[u8])` — i.e. the AccountInfo lifetime must be independent of the slice
/// lifetime. Anchor's `entry` ties them (`&'info [AccountInfo<'info>]`), so we
/// accept independent lifetimes and erase the distinction via transmute. The
/// references are all alive for the duration of the call, so this is sound.
fn entry_processor<'a, 'b, 'c>(
    program_id: &'a Pubkey,
    accounts: &'b [AccountInfo<'c>],
    data: &[u8],
) -> ProgramResult {
    let accounts: &[AccountInfo] = unsafe { std::mem::transmute(accounts) };
    arcenpay_solana::entry(program_id, accounts, data)
}

fn meta(pubkey: Pubkey, is_signer: bool, is_writable: bool) -> AccountMeta {
    AccountMeta {
        pubkey,
        is_signer,
        is_writable,
    }
}

fn initialize_config_ix(admin: Pubkey, config: Pubkey, treasury: Pubkey, fee_bps: u64) -> Instruction {
    let mut data = DISC_INITIALIZE_CONFIG.to_vec();
    data.extend_from_slice(treasury.as_ref());
    data.extend_from_slice(&fee_bps.to_le_bytes());
    Instruction {
        program_id: ID,
        accounts: vec![
            meta(admin, true, true),
            meta(config, false, true),
            meta(system_program::id(), false, false),
        ],
        data,
    }
}

fn create_plan_ix(
    provider: Pubkey,
    config: Pubkey,
    plan: Pubkey,
    plan_id: u64,
    price: u64,
    interval: i64,
    mint: Pubkey,
) -> Instruction {
    let mut data = DISC_CREATE_PLAN.to_vec();
    data.extend_from_slice(&plan_id.to_le_bytes());
    data.extend_from_slice(&price.to_le_bytes());
    data.extend_from_slice(&interval.to_le_bytes());
    data.extend_from_slice(mint.as_ref());
    Instruction {
        program_id: ID,
        accounts: vec![
            meta(config, false, false),
            meta(provider, true, true),
            meta(plan, false, true),
            meta(system_program::id(), false, false),
        ],
        data,
    }
}

#[allow(clippy::too_many_arguments)]
fn subscribe_ix(
    subscriber: Pubkey,
    config: Pubkey,
    plan: Pubkey,
    subscription: Pubkey,
    by_wallet: Pubkey,
    delegate: Pubkey,
    mint: Pubkey,
    subscriber_token: Pubkey,
    provider_token: Pubkey,
    treasury_token: Pubkey,
    token_id: u64,
    amount: u64,
) -> Instruction {
    let mut data = DISC_SUBSCRIBE.to_vec();
    data.extend_from_slice(&token_id.to_le_bytes());
    data.extend_from_slice(&amount.to_le_bytes());
    Instruction {
        program_id: ID,
        accounts: vec![
            meta(config, false, false),
            meta(plan, false, false),
            meta(subscriber, true, true),
            meta(subscription, false, true),
            meta(by_wallet, false, true),
            meta(delegate, false, false),
            meta(mint, false, false),
            meta(subscriber_token, false, true),
            meta(provider_token, false, true),
            meta(treasury_token, false, true),
            meta(spl_token::id(), false, false),
            meta(system_program::id(), false, false),
        ],
        data,
    }
}

/// `execute` takes no amount (the charge is the on-chain snapshot) and is
/// submitted by any funded relayer; the (owner, mint) delegate PDA is the SPL
/// spender.
#[allow(clippy::too_many_arguments)]
fn execute_ix(
    relayer: Pubkey,
    config: Pubkey,
    plan: Pubkey,
    subscription: Pubkey,
    delegate: Pubkey,
    mint: Pubkey,
    payer_token: Pubkey,
    provider_token: Pubkey,
    treasury_token: Pubkey,
) -> Instruction {
    Instruction {
        program_id: ID,
        accounts: vec![
            meta(config, false, false),
            meta(plan, false, false),
            meta(subscription, false, true),
            meta(relayer, true, true),
            meta(delegate, false, false),
            meta(mint, false, false),
            meta(payer_token, false, true),
            meta(provider_token, false, true),
            meta(treasury_token, false, true),
            meta(spl_token::id(), false, false),
        ],
        data: DISC_EXECUTE.to_vec(),
    }
}

fn reauthorize_autopay_ix(
    owner: Pubkey,
    subscription: Pubkey,
    delegate: Pubkey,
    subscriber_token: Pubkey,
    mint: Pubkey,
) -> Instruction {
    Instruction {
        program_id: ID,
        accounts: vec![
            meta(subscription, false, true),
            meta(owner, true, false),
            meta(delegate, false, false),
            meta(subscriber_token, false, true),
            meta(mint, false, false),
            meta(spl_token::id(), false, false),
        ],
        data: DISC_REAUTHORIZE_AUTOPAY.to_vec(),
    }
}

fn cancel_ix(owner: Pubkey, subscription: Pubkey) -> Instruction {
    Instruction {
        program_id: ID,
        accounts: vec![meta(subscription, false, true), meta(owner, true, false)],
        data: DISC_CANCEL.to_vec(),
    }
}

fn change_plan_ix(owner: Pubkey, subscription: Pubkey, new_plan: Pubkey, new_plan_id: u64) -> Instruction {
    let mut data = DISC_CHANGE_PLAN.to_vec();
    data.extend_from_slice(&new_plan_id.to_le_bytes());
    Instruction {
        program_id: ID,
        accounts: vec![
            meta(subscription, false, true),
            meta(new_plan, false, false),
            meta(owner, true, false),
        ],
        data,
    }
}

fn authorize_settler_ix(admin: Pubkey, config: Pubkey, settler_record: Pubkey, settler: Pubkey) -> Instruction {
    let mut data = DISC_AUTHORIZE_SETTLER.to_vec();
    data.extend_from_slice(settler.as_ref());
    Instruction {
        program_id: ID,
        accounts: vec![
            meta(config, false, false),
            meta(admin, true, true),
            meta(settler_record, false, true),
            meta(settler, false, false),
            meta(system_program::id(), false, false),
        ],
        data,
    }
}

#[allow(clippy::too_many_arguments)]
fn fund_session_ix(
    agent: Pubkey,
    config: Pubkey,
    vault_authority: Pubkey,
    session: Pubkey,
    mint: Pubkey,
    agent_token: Pubkey,
    vault_token: Pubkey,
    session_id: u64,
    amount: u64,
) -> Instruction {
    let mut data = DISC_FUND_SESSION.to_vec();
    data.extend_from_slice(&session_id.to_le_bytes());
    data.extend_from_slice(&amount.to_le_bytes());
    Instruction {
        program_id: ID,
        accounts: vec![
            meta(config, false, false),
            meta(vault_authority, false, false),
            meta(agent, true, true),
            meta(session, false, true),
            meta(mint, false, false),
            meta(agent_token, false, true),
            meta(vault_token, false, true),
            meta(spl_token::id(), false, false),
            meta(system_program::id(), false, false),
        ],
        data,
    }
}

#[allow(clippy::too_many_arguments)]
fn settle_ix(
    settler: Pubkey,
    config: Pubkey,
    settler_record: Pubkey,
    session: Pubkey,
    nullifier_record: Pubkey,
    vault_authority: Pubkey,
    mint: Pubkey,
    vault_token: Pubkey,
    provider_token: Pubkey,
    amount: u64,
    call_count: u64,
    nullifier: [u8; 32],
    proof: &[u8],
    public_inputs: &[u8],
    verifier_program: Option<Pubkey>,
) -> Instruction {
    let mut data = DISC_SETTLE.to_vec();
    data.extend_from_slice(&amount.to_le_bytes());
    data.extend_from_slice(&call_count.to_le_bytes());
    data.extend_from_slice(&nullifier);
    // Borsh Vec<u8> args: u32 LE length + bytes.
    data.extend_from_slice(&(proof.len() as u32).to_le_bytes());
    data.extend_from_slice(proof);
    data.extend_from_slice(&(public_inputs.len() as u32).to_le_bytes());
    data.extend_from_slice(public_inputs);

    let mut accounts = vec![
        meta(config, false, false),
        meta(settler_record, false, false),
        meta(settler, true, true),
        meta(session, false, true),
        meta(nullifier_record, false, true),
        meta(vault_authority, false, false),
        meta(mint, false, false),
        meta(vault_token, false, true),
        meta(provider_token, false, true),
        meta(spl_token::id(), false, false),
        meta(system_program::id(), false, false),
    ];
    // Anchor optional accounts always occupy a slot; passing the program id
    // (rather than omitting the key) signals `None`.
    accounts.push(meta(verifier_program.unwrap_or(ID), false, false));
    Instruction {
        program_id: ID,
        accounts,
        data,
    }
}

fn set_proof_verification_ix(
    admin: Pubkey,
    config: Pubkey,
    required: bool,
    verifier: Pubkey,
) -> Instruction {
    let mut data = DISC_SET_PROOF_VERIFICATION.to_vec();
    data.push(required as u8);
    data.extend_from_slice(verifier.as_ref());
    Instruction {
        program_id: ID,
        accounts: vec![meta(config, false, true), meta(admin, true, false)],
        data,
    }
}

fn withdraw_session_ix(
    agent: Pubkey,
    session: Pubkey,
    vault_authority: Pubkey,
    mint: Pubkey,
    vault_token: Pubkey,
    agent_token: Pubkey,
    amount: u64,
) -> Instruction {
    let mut data = DISC_WITHDRAW_SESSION.to_vec();
    data.extend_from_slice(&amount.to_le_bytes());
    Instruction {
        program_id: ID,
        accounts: vec![
            meta(session, false, true),
            meta(agent, true, false),
            meta(vault_authority, false, false),
            meta(mint, false, false),
            meta(vault_token, false, true),
            meta(agent_token, false, true),
            meta(spl_token::id(), false, false),
        ],
        data,
    }
}

// ─── fixtures ───────────────────────────────────────────────────────────────

fn system_account(lamports: u64) -> Account {
    Account {
        lamports,
        data: vec![],
        owner: system_program::id(),
        executable: false,
        rent_epoch: 0,
    }
}

fn mint_account(authority: Pubkey) -> Account {
    let mut mint = Mint::default();
    mint.mint_authority = authority.into();
    mint.decimals = DECIMALS;
    mint.is_initialized = true;
    let mut data = vec![0u8; Mint::LEN];
    Mint::pack(mint, &mut data).unwrap();
    Account {
        lamports: 10_000_000_000,
        data,
        owner: spl_token::id(),
        executable: false,
        rent_epoch: 0,
    }
}

fn token_account(mint: Pubkey, owner: Pubkey, amount: u64) -> Account {
    let mut acct = TokenAccount::default();
    acct.mint = mint;
    acct.owner = owner;
    acct.amount = amount;
    acct.state = AccountState::Initialized;
    let mut data = vec![0u8; TokenAccount::LEN];
    TokenAccount::pack(acct, &mut data).unwrap();
    Account {
        lamports: 10_000_000_000,
        data,
        owner: spl_token::id(),
        executable: false,
        rent_epoch: 0,
    }
}

async fn send(ctx: &mut ProgramTestContext, ixs: &[Instruction], extra: &[&Keypair]) {
    let payer = ctx.payer.insecure_clone();
    let mut signers: Vec<&Keypair> = vec![&payer];
    signers.extend_from_slice(extra);
    let tx = Transaction::new_signed_with_payer(
        ixs,
        Some(&payer.pubkey()),
        &signers,
        ctx.last_blockhash,
    );
    ctx.banks_client
        .process_transaction(tx)
        .await
        .expect("transaction failed");
}

async fn fails(ctx: &mut ProgramTestContext, ix: Instruction, extra: &[&Keypair]) -> bool {
    let payer = ctx.payer.insecure_clone();
    let mut signers: Vec<&Keypair> = vec![&payer];
    signers.extend_from_slice(extra);
    let tx = Transaction::new_signed_with_payer(
        &[ix],
        Some(&payer.pubkey()),
        &signers,
        ctx.last_blockhash,
    );
    ctx.banks_client.process_transaction(tx).await.is_err()
}

async fn read_subscription(ctx: &mut ProgramTestContext, key: Pubkey) -> Subscription {
    let acct = ctx
        .banks_client
        .get_account(key)
        .await
        .unwrap()
        .expect("subscription account missing");
    Subscription::try_deserialize(&mut acct.data.as_slice()).unwrap()
}

async fn token_balance(ctx: &mut ProgramTestContext, key: Pubkey) -> u64 {
    let acct = ctx.banks_client.get_account(key).await.unwrap().unwrap();
    TokenAccount::unpack(&acct.data).unwrap().amount
}

/// Reads the SPL `(delegate, delegated_amount)` pair from a token account.
async fn token_delegation(ctx: &mut ProgramTestContext, key: Pubkey) -> (Pubkey, u64) {
    let acct = ctx.banks_client.get_account(key).await.unwrap().unwrap();
    let token = TokenAccount::unpack(&acct.data).unwrap();
    (token.delegate.unwrap(), token.delegated_amount)
}

fn config_pda() -> Pubkey {
    Pubkey::find_program_address(&[b"config"], &ID).0
}
fn plan_pda(plan_id: u64) -> Pubkey {
    Pubkey::find_program_address(&[b"plan", &plan_id.to_le_bytes()], &ID).0
}
fn subscription_pda(token_id: u64) -> Pubkey {
    Pubkey::find_program_address(&[b"subscription", &token_id.to_le_bytes()], &ID).0
}
/// The shared autopay authority PDA for one (owner, mint) token account.
fn delegate_pda(owner: Pubkey, mint: Pubkey) -> (Pubkey, u8) {
    Pubkey::find_program_address(&[b"subscription_delegate", owner.as_ref(), mint.as_ref()], &ID)
}
fn by_wallet_pda(owner: Pubkey) -> Pubkey {
    Pubkey::find_program_address(&[b"subscription_wallet", owner.as_ref()], &ID).0
}

const DISC_SUBSCRIPTION_ACCOUNT: [u8; 8] = [64, 7, 26, 135, 102, 132, 98, 33];

/// Serializes a `Subscription` account fixture (Anchor account discriminator +
/// Borsh fields, matching `Subscription::LEN`), including the immutable autopay
/// snapshot.
#[allow(clippy::too_many_arguments)]
fn subscription_account(
    owner: Pubkey,
    token_id: u64,
    plan_id: u64,
    expiration: i64,
    total_paid: u64,
    renewal_price: u64,
    renewal_interval: i64,
    accepted_token: Pubkey,
    provider: Pubkey,
    subscriber_token: Pubkey,
    provider_token: Pubkey,
    treasury_token: Pubkey,
    authorization_expires_at: i64,
    remaining_renewals: u16,
    autopay_enabled: bool,
    delegate_bump: u8,
    bump: u8,
) -> Account {
    let mut data = DISC_SUBSCRIPTION_ACCOUNT.to_vec();
    data.extend_from_slice(owner.as_ref());
    data.extend_from_slice(&token_id.to_le_bytes());
    data.extend_from_slice(&plan_id.to_le_bytes());
    data.push(0); // plan_tier
    data.extend_from_slice(&expiration.to_le_bytes());
    data.push(1); // active
    data.extend_from_slice(&0i64.to_le_bytes()); // minted_at
    data.extend_from_slice(&0i64.to_le_bytes()); // last_renewed_at
    data.extend_from_slice(&total_paid.to_le_bytes());
    data.extend_from_slice(&renewal_price.to_le_bytes());
    data.extend_from_slice(&renewal_interval.to_le_bytes());
    data.extend_from_slice(accepted_token.as_ref());
    data.extend_from_slice(provider.as_ref());
    data.extend_from_slice(subscriber_token.as_ref());
    data.extend_from_slice(provider_token.as_ref());
    data.extend_from_slice(treasury_token.as_ref());
    data.extend_from_slice(&authorization_expires_at.to_le_bytes());
    data.extend_from_slice(&remaining_renewals.to_le_bytes());
    data.push(autopay_enabled as u8);
    data.push(delegate_bump);
    data.push(bump);
    assert_eq!(data.len(), 8 + Subscription::LEN, "fixture size");
    Account {
        lamports: 10_000_000_000,
        data,
        owner: ID,
        executable: false,
        rent_epoch: 0,
    }
}

// ─── test ───────────────────────────────────────────────────────────────────

#[tokio::test]
async fn full_lifecycle_including_renewal() {
    let provider = Keypair::new();
    let treasury = Keypair::new();
    let subscriber = Keypair::new();
    let mint = Pubkey::new_unique();

    let subscriber_token = Pubkey::new_unique();
    let provider_token = Pubkey::new_unique();
    let treasury_token = Pubkey::new_unique();

    // A subscription (token_id 2) whose last renewal is long past, so the
    // positive `execute` (renewal) path can be exercised. solana-program-test's
    // warp_to_slot does not advance the Clock's unix_timestamp, so instead of
    // warping we seed an already-aged subscription.
    const RENEW_TOKEN_ID: u64 = 2;
    let (renew_key, renew_bump) =
        Pubkey::find_program_address(&[b"subscription", &RENEW_TOKEN_ID.to_le_bytes()], &ID);

    // The autopay authority is shared per (owner, mint) — both subscriptions
    // below (token 1 and token 2) charge the same subscriber token account and
    // therefore share this one delegate.
    let (delegate_key, delegate_bump) = delegate_pda(subscriber.pubkey(), mint);

    // Session-vault fixtures.
    let settler = Keypair::new();
    let (vault_authority, _) = Pubkey::find_program_address(&[b"vault"], &ID);
    let vault_token = Pubkey::new_unique();
    const SESSION_ID: u64 = 7;
    let (session_key, _) = Pubkey::find_program_address(
        &[
            b"session",
            subscriber.pubkey().as_ref(),
            &SESSION_ID.to_le_bytes(),
        ],
        &ID,
    );
    let (settler_record, _) =
        Pubkey::find_program_address(&[b"settler", settler.pubkey().as_ref()], &ID);

    let mut pt = ProgramTest::new("arcenpay_solana", ID, processor!(entry_processor));
    pt.add_account(provider.pubkey(), system_account(10_000_000_000));
    pt.add_account(subscriber.pubkey(), system_account(10_000_000_000));
    // The settler pays rent for nullifier records on `settle`.
    pt.add_account(settler.pubkey(), system_account(10_000_000_000));
    pt.add_account(mint, mint_account(treasury.pubkey()));
    pt.add_account(subscriber_token, token_account(mint, subscriber.pubkey(), 100_000_000));
    pt.add_account(provider_token, token_account(mint, provider.pubkey(), 0));
    pt.add_account(treasury_token, token_account(mint, treasury.pubkey(), 0));
    pt.add_account(vault_token, token_account(mint, vault_authority, 0));
    pt.add_account(
        renew_key,
        subscription_account(
            subscriber.pubkey(),
            RENEW_TOKEN_ID,
            1,
            0, // expiration — already due
            0, // total_paid
            PRICE,
            INTERVAL,
            mint,
            provider.pubkey(),
            subscriber_token,
            provider_token,
            treasury_token,
            i64::MAX, // authorization_expires_at
            12,       // remaining_renewals
            true,     // autopay_enabled
            delegate_bump,
            renew_bump,
        ),
    );

    let mut ctx = pt.start_with_context().await;
    let config = config_pda();

    // initialize_config
    let ix = initialize_config_ix(ctx.payer.pubkey(), config, treasury.pubkey(), FEE_BPS);
    send(&mut ctx, &[ix], &[]).await;
    let cfg = ctx.banks_client.get_account(config).await.unwrap().unwrap();
    let cfg = Config::try_deserialize(&mut cfg.data.as_slice()).unwrap();
    assert_eq!(cfg.fee_bps, FEE_BPS);
    assert_eq!(cfg.treasury, treasury.pubkey());

    // create_plan(1)
    const PLAN_ID: u64 = 1;
    let plan1 = plan_pda(PLAN_ID);
    let ix = create_plan_ix(provider.pubkey(), config, plan1, PLAN_ID, PRICE, INTERVAL, mint);
    send(&mut ctx, &[ix], &[&provider]).await;
    let acct = ctx.banks_client.get_account(plan1).await.unwrap().unwrap();
    let plan = Plan::try_deserialize(&mut acct.data.as_slice()).unwrap();
    assert_eq!(plan.price, PRICE);
    assert!(plan.active);

    let fee = PRICE * FEE_BPS / 10_000;
    let net = PRICE - fee;

    // subscribe(token_id=1) — mint + first charge
    const TOKEN_ID: u64 = 1;
    let sub_key = subscription_pda(TOKEN_ID);
    let ix = subscribe_ix(
        subscriber.pubkey(),
        config,
        plan1,
        sub_key,
        by_wallet_pda(subscriber.pubkey()),
        delegate_key,
        mint,
        subscriber_token,
        provider_token,
        treasury_token,
        TOKEN_ID,
        PRICE,
    );
    send(&mut ctx, &[ix], &[&subscriber]).await;

    let sub = read_subscription(&mut ctx, sub_key).await;
    assert_eq!(sub.owner, subscriber.pubkey());
    assert!(sub.active);
    assert_eq!(sub.total_paid, PRICE);
    assert_eq!(token_balance(&mut ctx, subscriber_token).await, 100_000_000 - PRICE);
    assert_eq!(token_balance(&mut ctx, provider_token).await, net);
    assert_eq!(token_balance(&mut ctx, treasury_token).await, fee);

    // Renewal immediately after subscribe must be rejected (velocity guard).
    let early = execute_ix(
        subscriber.pubkey(),
        config,
        plan1,
        sub_key,
        delegate_key,
        mint,
        subscriber_token,
        provider_token,
        treasury_token,
    );
    assert!(fails(&mut ctx, early, &[&subscriber]).await, "early renewal must fail");

    // The subscription snapshotted the (shared) delegate and an allowance that
    // covers the whole authorization horizon (monthly ⇒ 12 renewals).
    let delegation = token_delegation(&mut ctx, subscriber_token).await;
    assert_eq!(delegation.0, delegate_key, "delegate is the shared (owner, mint) PDA");
    assert_eq!(delegation.1, PRICE * 12, "allowance covers 12 renewals");

    // Reauthorizing TOPS UP the shared allowance rather than replacing it, so a
    // reauthorize on one subscription can never wipe a sibling's budget.
    let ix = reauthorize_autopay_ix(
        subscriber.pubkey(),
        sub_key,
        delegate_key,
        subscriber_token,
        mint,
    );
    send(&mut ctx, &[ix], &[&subscriber]).await;
    let topped_up = token_delegation(&mut ctx, subscriber_token).await;
    assert_eq!(topped_up.0, delegate_key);
    assert_eq!(topped_up.1, PRICE * 24, "reauthorize tops up the shared allowance");

    // Positive renewal: the aged subscription (token 2) renews successfully.
    // The relayer here is the subscriber, but it has no spending power — the
    // shared delegate PDA signs the transfer.
    let ix = execute_ix(
        subscriber.pubkey(),
        config,
        plan1,
        renew_key,
        delegate_key,
        mint,
        subscriber_token,
        provider_token,
        treasury_token,
    );
    send(&mut ctx, &[ix], &[&subscriber]).await;
    let renewed = read_subscription(&mut ctx, renew_key).await;
    assert!(renewed.active, "still active after renewal");
    assert!(renewed.expiration > 0, "expiration advanced from 0");
    assert_eq!(renewed.total_paid, PRICE, "renewal recorded");
    // token1 subscription (fee+net) + token2 renewal (fee+net)
    assert_eq!(token_balance(&mut ctx, provider_token).await, net * 2);
    assert_eq!(token_balance(&mut ctx, treasury_token).await, fee * 2);

    // change_plan -> 2 (on the subscribed token)
    const PLAN2: u64 = 2;
    let plan2 = plan_pda(PLAN2);
    let ix = create_plan_ix(provider.pubkey(), config, plan2, PLAN2, 5_000_000, INTERVAL, mint);
    send(&mut ctx, &[ix], &[&provider]).await;
    let ix = change_plan_ix(subscriber.pubkey(), sub_key, plan2, PLAN2);
    send(&mut ctx, &[ix], &[&subscriber]).await;
    assert_eq!(read_subscription(&mut ctx, sub_key).await.plan_id, PLAN2);

    // cancel
    let ix = cancel_ix(subscriber.pubkey(), sub_key);
    send(&mut ctx, &[ix], &[&subscriber]).await;
    assert!(!read_subscription(&mut ctx, sub_key).await.active);

    // ── Session vault (ZKVUB usage settlement) ──────────────────────────────
    // authorize_settler (admin = payer)
    let ix = authorize_settler_ix(ctx.payer.pubkey(), config, settler_record, settler.pubkey());
    send(&mut ctx, &[ix], &[]).await;

    // fund_session with 5 USDC from the agent
    let ix = fund_session_ix(
        subscriber.pubkey(),
        config,
        vault_authority,
        session_key,
        mint,
        subscriber_token,
        vault_token,
        SESSION_ID,
        5_000_000,
    );
    send(&mut ctx, &[ix], &[&subscriber]).await;
    assert_eq!(token_balance(&mut ctx, vault_token).await, 5_000_000);
    {
        let acct = ctx.banks_client.get_account(session_key).await.unwrap().unwrap();
        let session = Session::try_deserialize(&mut acct.data.as_slice()).unwrap();
        assert_eq!(session.balance, 5_000_000);
        assert_eq!(session.agent, subscriber.pubkey());
        assert!(session.active);
    }

    // settle 2 USDC (settler-signed, vault PDA-signed transfer)
    let provider_before = token_balance(&mut ctx, provider_token).await;
    let nullifier: [u8; 32] = [9u8; 32];
    let (nullifier_record, _) =
        Pubkey::find_program_address(&[b"nullifier", nullifier.as_ref()], &ID);
    let ix = settle_ix(
        settler.pubkey(),
        config,
        settler_record,
        session_key,
        nullifier_record,
        vault_authority,
        mint,
        vault_token,
        provider_token,
        2_000_000,
        3,
        nullifier,
        &[],
        &[],
        None,
    );
    send(&mut ctx, &[ix], &[&settler]).await;
    assert_eq!(token_balance(&mut ctx, vault_token).await, 3_000_000);
    assert_eq!(token_balance(&mut ctx, provider_token).await, provider_before + 2_000_000);
    {
        let acct = ctx.banks_client.get_account(session_key).await.unwrap().unwrap();
        let session = Session::try_deserialize(&mut acct.data.as_slice()).unwrap();
        assert_eq!(session.balance, 3_000_000);
        assert_eq!(session.total_settled, 2_000_000);
    }

    // Replaying the SAME nullifier must be rejected (double-spend guard).
    let replay = settle_ix(
        settler.pubkey(),
        config,
        settler_record,
        session_key,
        nullifier_record,
        vault_authority,
        mint,
        vault_token,
        provider_token,
        1_000_000,
        1,
        nullifier,
        &[],
        &[],
        None,
    );
    assert!(
        fails(&mut ctx, replay, &[&settler]).await,
        "nullifier replay must be rejected"
    );

    // an unauthorized settler must be rejected
    let rogue = Keypair::new();
    let (rogue_record, _) =
        Pubkey::find_program_address(&[b"settler", rogue.pubkey().as_ref()], &ID);
    let rogue_nullifier: [u8; 32] = [8u8; 32];
    let (rogue_nullifier_record, _) =
        Pubkey::find_program_address(&[b"nullifier", rogue_nullifier.as_ref()], &ID);
    let ix = settle_ix(
        rogue.pubkey(),
        config,
        rogue_record,
        session_key,
        rogue_nullifier_record,
        vault_authority,
        mint,
        vault_token,
        provider_token,
        1_000_000,
        1,
        rogue_nullifier,
        &[],
        &[],
        None,
    );
    assert!(fails(&mut ctx, ix, &[&rogue]).await, "unauthorized settler must fail");

    // withdraw remaining 3 USDC back to the agent
    let agent_before = token_balance(&mut ctx, subscriber_token).await;
    let ix = withdraw_session_ix(
        subscriber.pubkey(),
        session_key,
        vault_authority,
        mint,
        vault_token,
        subscriber_token,
        3_000_000,
    );
    send(&mut ctx, &[ix], &[&subscriber]).await;
    assert_eq!(token_balance(&mut ctx, vault_token).await, 0);
    assert_eq!(token_balance(&mut ctx, subscriber_token).await, agent_before + 3_000_000);
    {
        let acct = ctx.banks_client.get_account(session_key).await.unwrap().unwrap();
        let session = Session::try_deserialize(&mut acct.data.as_slice()).unwrap();
        assert_eq!(session.balance, 0);
        assert!(!session.active);
    }
    println!("session vault (authorize/fund/settle/withdraw) OK");

    println!("lifecycle (incl. positive renewal) OK");
}

/// Exercises the `settle` ZK proof gate: the gate is opt-in, requires a
/// configured verifier program, rejects missing/invalid/mismatched proofs, and
/// can be turned back off. The mock verifier accepts `proof == b"valid"`.
#[tokio::test]
async fn settle_proof_gate() {
    let treasury = Keypair::new();
    let subscriber = Keypair::new();
    let settler = Keypair::new();
    let provider = Keypair::new();
    let mint = Pubkey::new_unique();
    let subscriber_token = Pubkey::new_unique();
    let provider_token = Pubkey::new_unique();
    let mock_verifier = Pubkey::new_from_array([42u8; 32]);

    let (vault_authority, _) = Pubkey::find_program_address(&[b"vault"], &ID);
    let vault_token = Pubkey::new_unique();
    const SESSION_ID: u64 = 11;
    let (session_key, _) = Pubkey::find_program_address(
        &[
            b"session",
            subscriber.pubkey().as_ref(),
            &SESSION_ID.to_le_bytes(),
        ],
        &ID,
    );
    let (settler_record, _) =
        Pubkey::find_program_address(&[b"settler", settler.pubkey().as_ref()], &ID);

    let mut pt = ProgramTest::new("arcenpay_solana", ID, processor!(entry_processor));
    pt.add_program(
        "mock_groth16_verifier",
        mock_verifier,
        processor!(mock_groth16_verifier::process_instruction),
    );
    pt.add_account(subscriber.pubkey(), system_account(10_000_000_000));
    pt.add_account(settler.pubkey(), system_account(10_000_000_000));
    pt.add_account(mint, mint_account(treasury.pubkey()));
    pt.add_account(subscriber_token, token_account(mint, subscriber.pubkey(), 100_000_000));
    pt.add_account(provider_token, token_account(mint, provider.pubkey(), 0));
    pt.add_account(vault_token, token_account(mint, vault_authority, 0));

    let mut ctx = pt.start_with_context().await;
    let config = config_pda();
    let admin = ctx.payer.pubkey();

    let ix = initialize_config_ix(admin, config, treasury.pubkey(), FEE_BPS);
    send(&mut ctx, &[ix], &[]).await;
    let ix = authorize_settler_ix(admin, config, settler_record, settler.pubkey());
    send(&mut ctx, &[ix], &[]).await;
    let ix = fund_session_ix(
        subscriber.pubkey(),
        config,
        vault_authority,
        session_key,
        mint,
        subscriber_token,
        vault_token,
        SESSION_ID,
        5_000_000,
    );
    send(&mut ctx, &[ix], &[&subscriber]).await;

    // Enable the proof gate (admin = payer).
    let ix = set_proof_verification_ix(admin, config, true, mock_verifier);
    send(&mut ctx, &[ix], &[]).await;

    // (1) Gate on, but no verifier account supplied -> rejected.
    let n1: [u8; 32] = [1u8; 32];
    let (nr1, _) = Pubkey::find_program_address(&[b"nullifier", n1.as_ref()], &ID);
    let ix = settle_ix(
        settler.pubkey(), config, settler_record, session_key, nr1, vault_authority, mint,
        vault_token, provider_token, 1_000_000, 1, n1, b"valid", &[], None,
    );
    assert!(
        fails(&mut ctx, ix, &[&settler]).await,
        "settle without a verifier account must fail while the proof gate is on"
    );

    // (2) Invalid proof -> rejected.
    let n2: [u8; 32] = [2u8; 32];
    let (nr2, _) = Pubkey::find_program_address(&[b"nullifier", n2.as_ref()], &ID);
    let ix = settle_ix(
        settler.pubkey(), config, settler_record, session_key, nr2, vault_authority, mint,
        vault_token, provider_token, 1_000_000, 1, n2, b"bad", &[], Some(mock_verifier),
    );
    assert!(
        fails(&mut ctx, ix, &[&settler]).await,
        "an invalid proof must be rejected"
    );

    // (3) Verifier mismatch -> rejected before any CPI.
    let n3: [u8; 32] = [3u8; 32];
    let (nr3, _) = Pubkey::find_program_address(&[b"nullifier", n3.as_ref()], &ID);
    let wrong_verifier = Pubkey::new_from_array([7u8; 32]);
    let ix = settle_ix(
        settler.pubkey(), config, settler_record, session_key, nr3, vault_authority, mint,
        vault_token, provider_token, 1_000_000, 1, n3, b"valid", &[], Some(wrong_verifier),
    );
    assert!(
        fails(&mut ctx, ix, &[&settler]).await,
        "a mismatched verifier program must be rejected"
    );

    // (4) Valid proof -> settles.
    let before = token_balance(&mut ctx, provider_token).await;
    let n4: [u8; 32] = [4u8; 32];
    let (nr4, _) = Pubkey::find_program_address(&[b"nullifier", n4.as_ref()], &ID);
    let ix = settle_ix(
        settler.pubkey(), config, settler_record, session_key, nr4, vault_authority, mint,
        vault_token, provider_token, 2_000_000, 5, n4, b"valid", &[], Some(mock_verifier),
    );
    send(&mut ctx, &[ix], &[&settler]).await;
    assert_eq!(
        token_balance(&mut ctx, provider_token).await,
        before + 2_000_000,
        "a valid proof must allow settlement"
    );

    // (5) Turning the gate off restores trusted-settler mode.
    send(
        &mut ctx,
        &[set_proof_verification_ix(admin, config, false, Pubkey::default())],
        &[],
    )
    .await;
    let n5: [u8; 32] = [5u8; 32];
    let (nr5, _) = Pubkey::find_program_address(&[b"nullifier", n5.as_ref()], &ID);
    let ix = settle_ix(
        settler.pubkey(), config, settler_record, session_key, nr5, vault_authority, mint,
        vault_token, provider_token, 1_000_000, 1, n5, &[], &[], None,
    );
    send(&mut ctx, &[ix], &[&settler]).await;

    println!("settle proof gate OK");
}
