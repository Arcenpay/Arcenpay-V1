// ============================================================
//  ArcenPay — Solana Subscription Billing Program (Anchor)
//
//  Mirrors the EVM launch-runtime contracts (SubscriptionRegistry,
//  PlanFactory, FeeCollector, ERC7579AutopayModule) as a single
//  Anchor program so the facilitator's SolanaChainAdapter can
//  decode the same five billing events it decodes for EVM/Stellar:
//
//    SubscriptionMinted / Renewed / Cancelled / PlanChanged
//    BillingExecuted
//
//  ⚠️  STATUS: scaffold. This program has NOT been built or tested —
//  the Anchor/Solana toolchain is not available in the current
//  environment. Run `anchor build && anchor test` before deploying,
//  and only then mirror the program id into
//  packages/internal-core/src/addresses.ts (SOLANA_* entries).
//
//  Event struct field order is load-bearing: the facilitator decodes
//  Anchor events by Borsh position, so reordering fields here breaks
//  apps/facilitator/src/services/solana-adapter.ts.
// ============================================================

use anchor_lang::prelude::*;
use anchor_lang::solana_program::program_option::COption;
use anchor_spl::token::{self, Approve, Token, TransferChecked};
use anchor_spl::token_interface::{Mint, TokenAccount};

// Placeholder program id — 32-byte base58 so it compiles.
// MUST match the deploy keypair: run `anchor keys sync` (or set this to the
// public key of target/deploy/arcenpay_solana-keypair.json) before deploying,
// otherwise the program fails at runtime with DeclaredProgramIdMismatch.
declare_id!("D4ECHyomENvFHrdXWHcRncTwwQ1EQbyY4ga3CkcaYCP3");

/// Protocol subscription fee: 50 bps (0.50%). Mirrors SUBSCRIPTION_FEE_BPS.
pub const SUBSCRIPTION_FEE_BPS: u64 = 50;
pub const BPS_DENOMINATOR: u64 = 10_000;
/// Minimum billing interval in seconds (30 days). Mirrors MIN_BILLING_INTERVAL.
pub const MIN_BILLING_INTERVAL: i64 = 2_592_000;
/// A subscriber never grants an unbounded token delegate. Authorizations span
/// at most one year and are renewed explicitly by the owner.
pub const AUTOPAY_AUTHORIZATION_HORIZON: i64 = 31_622_400;

#[program]
pub mod arcenpay_solana {
    use super::*;

    /// One-time program configuration: admin + treasury + fee rate.
    pub fn initialize_config(
        ctx: Context<InitializeConfig>,
        treasury: Pubkey,
        fee_bps: u64,
    ) -> Result<()> {
        require!(fee_bps <= 1_000, ArcenPayError::InvalidFeeRate);
        let config = &mut ctx.accounts.config;
        config.admin = ctx.accounts.admin.key();
        config.treasury = treasury;
        config.fee_bps = fee_bps;
        config.plan_count = 0;
        // Proof verification is opt-in; enable it via `set_proof_verification`
        // once a verifier program is deployed.
        config.proof_verification_required = false;
        config.groth16_verifier = Pubkey::default();
        config.bump = ctx.bumps.config;
        Ok(())
    }

    /// Provider registers a plan. `price` is the amount charged per interval
    /// in the accepted token's atomic units (USDC = micros, 6 decimals).
    pub fn create_plan(
        ctx: Context<CreatePlan>,
        plan_id: u64,
        price: u64,
        billing_interval: i64,
        accepted_token: Pubkey,
    ) -> Result<()> {
        require!(
            billing_interval >= MIN_BILLING_INTERVAL,
            ArcenPayError::IntervalTooShort
        );
        require!(price > 0, ArcenPayError::InvalidPrice);

        let plan = &mut ctx.accounts.plan;
        plan.plan_id = plan_id;
        plan.provider = ctx.accounts.provider.key();
        plan.price = price;
        plan.billing_interval = billing_interval;
        plan.accepted_token = accepted_token;
        plan.active = true;
        plan.bump = ctx.bumps.plan;

        let config = &mut ctx.accounts.config;
        config.plan_count = config.plan_count.saturating_add(1);

        emit!(PlanCreated {
            plan_id,
            provider: plan.provider,
            price,
            billing_interval,
        });
        Ok(())
    }

    /// Update or deactivate a plan (provider only).
    pub fn update_plan(
        ctx: Context<UpdatePlan>,
        price: u64,
        billing_interval: i64,
        active: bool,
    ) -> Result<()> {
        require!(
            billing_interval >= MIN_BILLING_INTERVAL,
            ArcenPayError::IntervalTooShort
        );
        let plan = &mut ctx.accounts.plan;
        // price == 0 means "leave unchanged" (mirrors the Stellar port).
        if price > 0 {
            plan.price = price;
        }
        plan.billing_interval = billing_interval;
        plan.active = active;

        emit!(PlanUpdated {
            plan_id: plan.plan_id,
            price: plan.price,
            billing_interval,
            active,
        });
        Ok(())
    }

    /// Subscribe a wallet to a plan: creates the subscription, captures the
    /// first payment, and emits Minted + BillingExecuted(reason 0).
    ///
    /// Wallet may be the signer (self-serve) OR a caller the wallet owner
    /// pre-authorized via `configure_autopay` (see `execute`).
    pub fn subscribe(
        ctx: Context<Subscribe>,
        token_id: u64,
        amount: u64,
    ) -> Result<()> {
        let plan = &ctx.accounts.plan;
        require!(plan.active, ArcenPayError::PlanInactive);
        require!(
            ctx.accounts.token_mint.key() == plan.accepted_token,
            ArcenPayError::TokenMismatch
        );
        require!(amount >= plan.price, ArcenPayError::InsufficientAmount);

        let now = Clock::get()?.unix_timestamp;
        let expiration = now
            .checked_add(plan.billing_interval)
            .ok_or(ArcenPayError::MathOverflow)?;

        // ── transfer: subscriber → provider (net) + treasury (fee) ──
        let (merchant_amount, protocol_fee) = split_fee(amount, ctx.accounts.config.fee_bps)?;
        transfer_checked(
            &ctx.accounts.token_program,
            &ctx.accounts.subscriber_token,
            &ctx.accounts.token_mint,
            &ctx.accounts.provider_token,
            &ctx.accounts.subscriber,
            merchant_amount,
            ctx.accounts.token_mint.decimals,
        )?;
        if protocol_fee > 0 {
            transfer_checked(
                &ctx.accounts.token_program,
                &ctx.accounts.subscriber_token,
                &ctx.accounts.token_mint,
                &ctx.accounts.treasury_token,
                &ctx.accounts.subscriber,
                protocol_fee,
                ctx.accounts.token_mint.decimals,
            )?;
        }

        let sub = &mut ctx.accounts.subscription;
        sub.owner = ctx.accounts.subscriber.key();
        sub.token_id = token_id;
        sub.plan_id = plan.plan_id;
        sub.plan_tier = 0;
        sub.expiration = expiration;
        sub.active = true;
        sub.minted_at = now;
        sub.last_renewed_at = now;
        sub.total_paid = amount;
        // The delegate is a per-(owner, mint) PDA. It can only sign inside this
        // program and `execute` below pins every economically relevant field to
        // this snapshot, so a provider plan edit cannot increase an existing
        // customer's debit.
        let renewal_count = authorization_renewal_count(plan.billing_interval);
        let subscription_allowance = plan
            .price
            .checked_mul(renewal_count as u64)
            .ok_or(ArcenPayError::MathOverflow)?;
        // A token account has exactly ONE delegate slot, and this PDA is shared
        // by every ArcenPay subscription charging the same token account — so
        // approve must TOP UP an ArcenPay-owned allowance rather than replace
        // it. Otherwise a second subscription would wipe the first one's
        // remaining budget and silently break its renewals. A delegate owned by
        // someone else is taken over at exactly this subscription's allowance
        // (never inflated with their budget).
        let allowance = delegated_allowance_for(
            &ctx.accounts.subscriber_token,
            &ctx.accounts.delegate.key(),
            subscription_allowance,
        )?;
        let approve_accounts = Approve {
            to: ctx.accounts.subscriber_token.to_account_info(),
            delegate: ctx.accounts.delegate.to_account_info(),
            authority: ctx.accounts.subscriber.to_account_info(),
        };
        token::approve(
            CpiContext::new(ctx.accounts.token_program.to_account_info(), approve_accounts),
            allowance,
        )?;
        sub.renewal_price = plan.price;
        sub.renewal_interval = plan.billing_interval;
        sub.accepted_token = plan.accepted_token;
        sub.provider = plan.provider;
        sub.subscriber_token = ctx.accounts.subscriber_token.key();
        sub.provider_token = ctx.accounts.provider_token.key();
        sub.treasury_token = ctx.accounts.treasury_token.key();
        sub.authorization_expires_at = now
            .checked_add(AUTOPAY_AUTHORIZATION_HORIZON)
            .ok_or(ArcenPayError::MathOverflow)?;
        sub.remaining_renewals = renewal_count;
        sub.autopay_enabled = true;
        sub.delegate_bump = ctx.bumps.delegate;
        sub.bump = ctx.bumps.subscription;

        let by_wallet = &mut ctx.accounts.subscription_by_wallet;
        by_wallet.token_id = token_id;
        by_wallet.owner = ctx.accounts.subscriber.key();
        by_wallet.bump = ctx.bumps.subscription_by_wallet;

        emit!(SubscriptionMinted {
            subscriber: ctx.accounts.subscriber.key(),
            token_id,
            plan_id: plan.plan_id,
            expiration,
        });
        emit!(BillingExecuted {
            account: ctx.accounts.subscriber.key(),
            merchant: plan.provider,
            token_id,
            plan_id: plan.plan_id,
            reason: 0,
            gross_amount: amount,
            merchant_amount,
            protocol_fee,
            timestamp: now,
        });
        Ok(())
    }

    /// Renew a subscription using its bounded, owner-approved PDA delegate.
    /// The relayer only pays network fees; it cannot select a destination,
    /// amount, or source account outside the subscription snapshot.
    /// Emits Renewed + BillingExecuted(reason 1).
    pub fn execute(ctx: Context<Execute>) -> Result<()> {
        let sub = &mut ctx.accounts.subscription;
        require!(sub.active, ArcenPayError::SubscriptionInactive);
        require!(sub.autopay_enabled, ArcenPayError::AutopayDisabled);
        require!(sub.remaining_renewals > 0, ArcenPayError::AuthorizationDepleted);
        require!(
            ctx.accounts.token_mint.key() == sub.accepted_token,
            ArcenPayError::TokenMismatch
        );

        let now = Clock::get()?.unix_timestamp;
        require!(now <= sub.authorization_expires_at, ArcenPayError::AuthorizationExpired);
        require!(
            now >= sub.expiration,
            ArcenPayError::RenewalTooEarly
        );
        require!(ctx.accounts.plan.plan_id == sub.plan_id, ArcenPayError::PlanMismatch);

        let (merchant_amount, protocol_fee) = split_fee(sub.renewal_price, ctx.accounts.config.fee_bps)?;
        // The delegate authority is derived from (owner, accepted mint) — one
        // shared ArcenPay delegate per token account — so the seed here must
        // match `Subscribe`/`ReauthorizeAutopay` exactly.
        let delegate_bump = sub.delegate_bump;
        let owner_bytes = sub.owner.to_bytes();
        let mint_bytes = sub.accepted_token.to_bytes();
        let signer_seed: &[&[u8]] = &[
            b"subscription_delegate",
            owner_bytes.as_ref(),
            mint_bytes.as_ref(),
            &[delegate_bump],
        ];
        transfer_checked_signed(
            &ctx.accounts.token_program,
            &ctx.accounts.payer_token,
            &ctx.accounts.token_mint,
            &ctx.accounts.provider_token,
            &ctx.accounts.delegate.to_account_info(),
            &[signer_seed],
            merchant_amount,
            ctx.accounts.token_mint.decimals,
        )?;
        if protocol_fee > 0 {
            transfer_checked_signed(
                &ctx.accounts.token_program,
                &ctx.accounts.payer_token,
                &ctx.accounts.token_mint,
                &ctx.accounts.treasury_token,
                &ctx.accounts.delegate.to_account_info(),
                &[signer_seed],
                protocol_fee,
                ctx.accounts.token_mint.decimals,
            )?;
        }

        let expiration = now
            .checked_add(sub.renewal_interval)
            .ok_or(ArcenPayError::MathOverflow)?;
        sub.expiration = expiration;
        sub.last_renewed_at = now;
        sub.total_paid = sub.total_paid.saturating_add(sub.renewal_price);
        sub.remaining_renewals = sub.remaining_renewals.saturating_sub(1);

        emit!(SubscriptionRenewed {
            token_id: sub.token_id,
            new_expiration: expiration,
            amount_paid: sub.renewal_price,
        });
        emit!(BillingExecuted {
            account: sub.owner,
            merchant: sub.provider,
            token_id: sub.token_id,
            plan_id: sub.plan_id,
            reason: 1,
            gross_amount: sub.renewal_price,
            merchant_amount,
            protocol_fee,
            timestamp: now,
        });
        Ok(())
    }

    /// Cancel a subscription (owner only). Sets active = false.
    pub fn cancel(ctx: Context<Cancel>) -> Result<()> {
        let sub = &mut ctx.accounts.subscription;
        sub.active = false;
        sub.autopay_enabled = false;
        emit!(SubscriptionCancelled {
            token_id: sub.token_id,
        });
        Ok(())
    }

    /// Owner can pause future automatic collection without cancelling access.
    pub fn pause_autopay(ctx: Context<AutopayControl>) -> Result<()> {
        ctx.accounts.subscription.autopay_enabled = false;
        Ok(())
    }

    /// Owner reauthorizes the same immutable subscription snapshot, restoring a
    /// one-year horizon of renewals.
    ///
    /// The delegate is shared per (owner, mint), so this TOPS UP the pooled
    /// ArcenPay allowance rather than resetting it (which would wipe a sibling
    /// subscription's budget). The authoritative per-subscription limit stays
    /// `remaining_renewals`; the SPL allowance is a coarse backstop.
    pub fn reauthorize_autopay(ctx: Context<ReauthorizeAutopay>) -> Result<()> {
        let sub = &mut ctx.accounts.subscription;
        let now = Clock::get()?.unix_timestamp;
        let renewal_count = authorization_renewal_count(sub.renewal_interval);
        let subscription_allowance = sub.renewal_price
            .checked_mul(renewal_count as u64)
            .ok_or(ArcenPayError::MathOverflow)?;
        let allowance = delegated_allowance_for(
            &ctx.accounts.subscriber_token,
            &ctx.accounts.delegate.key(),
            subscription_allowance,
        )?;
        let approve_accounts = Approve {
            to: ctx.accounts.subscriber_token.to_account_info(),
            delegate: ctx.accounts.delegate.to_account_info(),
            authority: ctx.accounts.owner.to_account_info(),
        };
        token::approve(
            CpiContext::new(ctx.accounts.token_program.to_account_info(), approve_accounts),
            allowance,
        )?;
        sub.authorization_expires_at = now
            .checked_add(AUTOPAY_AUTHORIZATION_HORIZON)
            .ok_or(ArcenPayError::MathOverflow)?;
        sub.remaining_renewals = renewal_count;
        sub.autopay_enabled = true;
        Ok(())
    }

    /// Change the plan on an existing subscription (owner only).
    pub fn change_plan(ctx: Context<ChangePlan>, new_plan_id: u64) -> Result<()> {
        let new_plan = &ctx.accounts.new_plan;
        require!(new_plan.active, ArcenPayError::PlanInactive);
        let sub = &mut ctx.accounts.subscription;
        let previous = sub.plan_id;
        require!(previous != new_plan_id, ArcenPayError::SamePlan);

        let now = Clock::get()?.unix_timestamp;
        let expiration = now
            .checked_add(new_plan.billing_interval)
            .ok_or(ArcenPayError::MathOverflow)?;
        sub.plan_id = new_plan_id;
        sub.expiration = expiration;

        emit!(SubscriptionPlanChanged {
            token_id: sub.token_id,
            previous_plan_id: previous,
            new_plan_id,
            expiration,
        });
        Ok(())
    }

    /// Authorize an address to settle ZKVUB usage sessions (admin only).
    pub fn authorize_settler(ctx: Context<AuthorizeSettler>, settler: Pubkey) -> Result<()> {
        let record = &mut ctx.accounts.settler_record;
        record.settler = settler;
        record.bump = ctx.bumps.settler_record;
        emit!(SettlerAuthorized { settler });
        Ok(())
    }

    /// Fund (or top up) a prepaid usage session (agent-signed).
    pub fn fund_session(ctx: Context<FundSession>, session_id: u64, amount: u64) -> Result<()> {
        require!(amount > 0, ArcenPayError::InsufficientAmount);
        let now = Clock::get()?.unix_timestamp;
        transfer_checked(
            &ctx.accounts.token_program,
            &ctx.accounts.agent_token,
            &ctx.accounts.token_mint,
            &ctx.accounts.vault_token,
            &ctx.accounts.agent,
            amount,
            ctx.accounts.token_mint.decimals,
        )?;

        let session = &mut ctx.accounts.session;
        if session.created_at == 0 {
            session.agent = ctx.accounts.agent.key();
            session.session_id = session_id;
            session.token = ctx.accounts.token_mint.key();
            session.created_at = now;
            session.bump = ctx.bumps.session;
        }
        session.balance = session
            .balance
            .checked_add(amount)
            .ok_or(ArcenPayError::MathOverflow)?;
        session.total_funded = session
            .total_funded
            .checked_add(amount)
            .ok_or(ArcenPayError::MathOverflow)?;
        session.active = true;

        emit!(SessionFunded {
            session_id,
            agent: session.agent,
            amount,
            balance: session.balance,
        });
        Ok(())
    }

    /// Settle a usage session: move `amount` from the vault to the provider
    /// (settler-signed). Mirrors the EVM `ZKUsageVerifier` settlement leg.
    ///
    /// `nullifier` is a 32-byte unique value for this settlement (e.g. the
    /// usage-proof nullifier / payment nonce). It is recorded in a
    /// `["nullifier", nullifier]` PDA so the SAME settlement cannot be applied
    /// twice (double-spend guard), matching the EVM `usedNullifiers` check.
    ///
    /// When `config.proof_verification_required` is set, a Groth16 proof is
    /// verified by CPI into the configured `groth16_verifier` program before
    /// any funds move. Otherwise the authorized settler is trusted to have
    /// verified usage off-chain and the nullifier alone prevents replay. See
    /// the README.
    pub fn settle(
        ctx: Context<Settle>,
        amount: u64,
        call_count: u64,
        nullifier: [u8; 32],
        proof: Vec<u8>,
        public_inputs: Vec<u8>,
    ) -> Result<()> {
        // Optional ZK proof gate: when enabled, CPI into the configured
        // verifier program and require it to accept before moving funds.
        if ctx.accounts.config.proof_verification_required {
            let verifier = ctx
                .accounts
                .verifier_program
                .as_ref()
                .ok_or(ArcenPayError::ProofVerificationRequired)?;
            require!(
                verifier.key() == ctx.accounts.config.groth16_verifier,
                ArcenPayError::VerifierMismatch
            );
            verify_proof_cpi(verifier, &proof, &public_inputs)?;
        }

        let session = &mut ctx.accounts.session;
        require!(session.active, ArcenPayError::SessionInactive);
        require!(
            session.token == ctx.accounts.token_mint.key(),
            ArcenPayError::TokenMismatch
        );
        require!(
            session.balance >= amount,
            ArcenPayError::InsufficientSessionBalance
        );

        let record = &mut ctx.accounts.nullifier_record;
        record.nullifier = nullifier;
        record.settled_at = Clock::get()?.unix_timestamp;
        record.bump = ctx.bumps.nullifier_record;

        let now = Clock::get()?.unix_timestamp;
        let bump = ctx.bumps.vault_authority;
        transfer_checked_signed(
            &ctx.accounts.token_program,
            &ctx.accounts.vault_token,
            &ctx.accounts.token_mint,
            &ctx.accounts.provider_token,
            &ctx.accounts.vault_authority.to_account_info(),
            &[&[b"vault", &[bump]]],
            amount,
            ctx.accounts.token_mint.decimals,
        )?;

        session.balance = session
            .balance
            .checked_sub(amount)
            .ok_or(ArcenPayError::MathOverflow)?;
        session.total_settled = session
            .total_settled
            .checked_add(amount)
            .ok_or(ArcenPayError::MathOverflow)?;
        if session.balance == 0 {
            session.active = false;
        }

        emit!(BillingSettled {
            session_id: session.session_id,
            agent: session.agent,
            call_count,
            settlement_amount: amount,
            window_start: session.created_at,
            window_end: now,
        });
        Ok(())
    }

    /// Withdraw remaining session balance back to the agent (agent-signed).
    pub fn withdraw_session(ctx: Context<WithdrawSession>, amount: u64) -> Result<()> {
        let session = &mut ctx.accounts.session;
        require!(
            session.balance >= amount,
            ArcenPayError::InsufficientSessionBalance
        );

        let bump = ctx.bumps.vault_authority;
        transfer_checked_signed(
            &ctx.accounts.token_program,
            &ctx.accounts.vault_token,
            &ctx.accounts.token_mint,
            &ctx.accounts.agent_token,
            &ctx.accounts.vault_authority.to_account_info(),
            &[&[b"vault", &[bump]]],
            amount,
            ctx.accounts.token_mint.decimals,
        )?;

        session.balance -= amount;
        if session.balance == 0 {
            session.active = false;
        }

        emit!(SessionWithdrawn {
            session_id: session.session_id,
            agent: session.agent,
            amount,
            balance: session.balance,
        });
        Ok(())
    }

    /// Admin-only: enable/disable the ZK proof gate and set the verifier
    /// program used by `settle`.
    pub fn set_proof_verification(
        ctx: Context<SetProofVerification>,
        required: bool,
        verifier: Pubkey,
    ) -> Result<()> {
        let config = &mut ctx.accounts.config;
        config.proof_verification_required = required;
        config.groth16_verifier = verifier;
        emit!(ProofVerificationUpdated { required, verifier });
        Ok(())
    }

    /// Admin-only, one-time: grow an existing pre-proof-gate `Config` account to
    /// the current layout and default the new fields (proof gate off).
    ///
    /// `Config` gained `proof_verification_required` + `groth16_verifier`, which
    /// changed its size. Configs created before that change are too small and
    /// would fail Anchor's serialization on write. This reallocates the account
    /// in place and preserves `admin`/`treasury`/`fee_bps`/`plan_count`/`bump`.
    ///
    /// Reads the raw account (not `Account<Config>`) because the new struct no
    /// longer fits the old buffer.
    pub fn migrate_config(ctx: Context<MigrateConfig>) -> Result<()> {
        let config_info = ctx.accounts.config.to_account_info();
        require_keys_eq!(*config_info.owner, crate::ID, ArcenPayError::Unauthorized);

        const OLD_LEN: usize = 8 + 81; // 8 + (32+32+8+8+1) — pre-proof-gate layout
        let old_bump: u8 = {
            let data = config_info.try_borrow_data()?;
            require!(data.len() >= OLD_LEN, ArcenPayError::Unauthorized);
            let admin = Pubkey::try_from(&data[8..40]).map_err(|_| ArcenPayError::Unauthorized)?;
            require_keys_eq!(admin, ctx.accounts.admin.key(), ArcenPayError::Unauthorized);
            data[8 + 80]
        };

        // Top the account up to the new rent-exempt minimum before growing it.
        let new_min = Rent::get()?.minimum_balance(8 + Config::LEN);
        let current = config_info.lamports();
        if new_min > current {
            anchor_lang::solana_program::program::invoke(
                &anchor_lang::solana_program::system_instruction::transfer(
                    &ctx.accounts.admin.key(),
                    &config_info.key(),
                    new_min - current,
                ),
                &[
                    ctx.accounts.admin.to_account_info(),
                    config_info.clone(),
                ],
            )?;
        }

        config_info.realloc(8 + Config::LEN, false)?;

        let mut data = config_info.try_borrow_mut_data()?;
        let mut cursor = 8 + 80;
        data[cursor] = 0; // proof_verification_required = false
        cursor += 1;
        for byte in data[cursor..cursor + 32].iter_mut() {
            *byte = 0; // groth16_verifier = Pubkey::default()
        }
        cursor += 32;
        data[cursor] = old_bump;
        Ok(())
    }

    /// Admin-only recovery: close a subscription and its wallet index PDA,
    /// returning their rent to the admin.
    ///
    /// The subscription PDAs are deterministic, so a program layout upgrade (or
    /// a failed finalize) can leave an account that blocks the wallet from ever
    /// subscribing again. Reading the accounts raw — instead of
    /// `Account<Subscription>` — lets a subscription written by an *older*
    /// program layout still be reclaimed, for the same reason `migrate_config`
    /// reads raw bytes. Ops/devnet only.
    pub fn close_subscription(
        ctx: Context<CloseSubscription>,
        _token_id: u64,
        _owner: Pubkey,
    ) -> Result<()> {
        let dest = ctx.accounts.admin.to_account_info();
        for account in [
            ctx.accounts.subscription.to_account_info(),
            ctx.accounts.subscription_by_wallet.to_account_info(),
        ] {
            // Only ever reclaim accounts this program actually owns; a
            // non-existent (or foreign) account is left untouched.
            if account.lamports() == 0 || *account.owner != crate::ID {
                continue;
            }
            let lamports = account.lamports();
            let dest_total = dest
                .lamports()
                .checked_add(lamports)
                .ok_or(ArcenPayError::MathOverflow)?;
            **dest.try_borrow_mut_lamports()? = dest_total;
            **account.try_borrow_mut_lamports()? = 0;
            account.assign(&anchor_lang::solana_program::system_program::ID);
            account.realloc(0, false)?;
        }
        Ok(())
    }
}

// ─── Account contexts ───────────────────────────────────────────────────────

#[derive(Accounts)]
pub struct InitializeConfig<'info> {
    #[account(mut)]
    pub admin: Signer<'info>,
    #[account(
        init,
        payer = admin,
        space = 8 + Config::LEN,
        seeds = [b"config"],
        bump,
    )]
    pub config: Account<'info, Config>,
    pub system_program: Program<'info, System>,
}

#[derive(Accounts)]
#[instruction(plan_id: u64)]
pub struct CreatePlan<'info> {
    #[account(seeds = [b"config"], bump = config.bump)]
    pub config: Account<'info, Config>,
    #[account(mut)]
    pub provider: Signer<'info>,
    #[account(
        init,
        payer = provider,
        space = 8 + Plan::LEN,
        seeds = [b"plan", plan_id.to_le_bytes().as_ref()],
        bump,
    )]
    pub plan: Account<'info, Plan>,
    pub system_program: Program<'info, System>,
}

#[derive(Accounts)]
pub struct UpdatePlan<'info> {
    #[account(
        mut,
        seeds = [b"plan", plan.plan_id.to_le_bytes().as_ref()],
        bump = plan.bump,
        has_one = provider @ ArcenPayError::Unauthorized,
    )]
    pub plan: Account<'info, Plan>,
    pub provider: Signer<'info>,
}

#[derive(Accounts)]
#[instruction(token_id: u64)]
pub struct Subscribe<'info> {
    #[account(seeds = [b"config"], bump = config.bump)]
    pub config: Account<'info, Config>,
    #[account(seeds = [b"plan", plan.plan_id.to_le_bytes().as_ref()], bump = plan.bump)]
    pub plan: Account<'info, Plan>,
    #[account(mut)]
    pub subscriber: Signer<'info>,
    #[account(
        init,
        payer = subscriber,
        space = 8 + Subscription::LEN,
        seeds = [b"subscription", token_id.to_le_bytes().as_ref()],
        bump,
    )]
    pub subscription: Account<'info, Subscription>,
    #[account(
        init,
        payer = subscriber,
        space = 8 + SubscriptionByWallet::LEN,
        seeds = [b"subscription_wallet", subscriber.key().as_ref()],
        bump,
    )]
    pub subscription_by_wallet: Account<'info, SubscriptionByWallet>,
    /// CHECK: per-(owner, mint) autopay authority PDA, used only as the SPL
    /// token delegate. Shared by every ArcenPay subscription charging the same
    /// token account, so a second subscription cannot replace — and silently
    /// break — the first subscription's delegate.
    #[account(
        seeds = [
            b"subscription_delegate",
            subscriber.key().as_ref(),
            plan.accepted_token.as_ref(),
        ],
        bump,
    )]
    pub delegate: UncheckedAccount<'info>,
    // Boxed to keep the `try_accounts` stack frame within the SBF 4096-byte
    // limit (unboxed, the Subscribe context exceeded it).
    pub token_mint: Box<InterfaceAccount<'info, Mint>>,
    #[account(mut, token::mint = token_mint, token::authority = subscriber)]
    pub subscriber_token: Box<InterfaceAccount<'info, TokenAccount>>,
    #[account(mut, token::mint = token_mint, token::authority = plan.provider)]
    pub provider_token: Box<InterfaceAccount<'info, TokenAccount>>,
    #[account(mut, token::mint = token_mint)]
    pub treasury_token: Box<InterfaceAccount<'info, TokenAccount>>,
    pub token_program: Program<'info, Token>,
    pub system_program: Program<'info, System>,
}

#[derive(Accounts)]
pub struct Execute<'info> {
    #[account(seeds = [b"config"], bump = config.bump)]
    pub config: Account<'info, Config>,
    #[account(seeds = [b"plan", plan.plan_id.to_le_bytes().as_ref()], bump = plan.bump)]
    pub plan: Account<'info, Plan>,
    #[account(
        mut,
        seeds = [b"subscription", subscription.token_id.to_le_bytes().as_ref()],
        bump = subscription.bump,
    )]
    pub subscription: Account<'info, Subscription>,
    /// Any funded relayer can submit a due renewal. It has no spending power;
    /// the PDA below is the only SPL authority used by this instruction.
    pub relayer: Signer<'info>,
    /// CHECK: validated as the (owner, mint) delegate PDA recorded on the
    /// subscription. Shared across that wallet's ArcenPay subscriptions.
    #[account(
        seeds = [
            b"subscription_delegate",
            subscription.owner.as_ref(),
            subscription.accepted_token.as_ref(),
        ],
        bump = subscription.delegate_bump,
    )]
    pub delegate: UncheckedAccount<'info>,
    pub token_mint: InterfaceAccount<'info, Mint>,
    #[account(mut, address = subscription.subscriber_token @ ArcenPayError::TokenAccountMismatch, token::mint = token_mint)]
    pub payer_token: InterfaceAccount<'info, TokenAccount>,
    #[account(mut, address = subscription.provider_token @ ArcenPayError::TokenAccountMismatch, token::mint = token_mint)]
    pub provider_token: InterfaceAccount<'info, TokenAccount>,
    #[account(mut, address = subscription.treasury_token @ ArcenPayError::TokenAccountMismatch, token::mint = token_mint)]
    pub treasury_token: InterfaceAccount<'info, TokenAccount>,
    pub token_program: Program<'info, Token>,
}

#[derive(Accounts)]
pub struct Cancel<'info> {
    #[account(
        mut,
        seeds = [b"subscription", subscription.token_id.to_le_bytes().as_ref()],
        bump = subscription.bump,
        has_one = owner @ ArcenPayError::Unauthorized,
    )]
    pub subscription: Account<'info, Subscription>,
    pub owner: Signer<'info>,
}

#[derive(Accounts)]
pub struct AutopayControl<'info> {
    #[account(
        mut,
        seeds = [b"subscription", subscription.token_id.to_le_bytes().as_ref()],
        bump = subscription.bump,
        has_one = owner @ ArcenPayError::Unauthorized,
    )]
    pub subscription: Account<'info, Subscription>,
    pub owner: Signer<'info>,
}

#[derive(Accounts)]
pub struct ReauthorizeAutopay<'info> {
    #[account(
        mut,
        seeds = [b"subscription", subscription.token_id.to_le_bytes().as_ref()],
        bump = subscription.bump,
        has_one = owner @ ArcenPayError::Unauthorized,
    )]
    pub subscription: Account<'info, Subscription>,
    pub owner: Signer<'info>,
    /// CHECK: the (owner, mint) delegate PDA — same address the subscription
    /// recorded and `execute` signs with.
    #[account(
        seeds = [
            b"subscription_delegate",
            owner.key().as_ref(),
            subscription.accepted_token.as_ref(),
        ],
        bump = subscription.delegate_bump,
    )]
    pub delegate: UncheckedAccount<'info>,
    #[account(mut, address = subscription.subscriber_token @ ArcenPayError::TokenAccountMismatch, token::mint = token_mint, token::authority = owner)]
    pub subscriber_token: InterfaceAccount<'info, TokenAccount>,
    pub token_mint: InterfaceAccount<'info, Mint>,
    pub token_program: Program<'info, Token>,
}

#[derive(Accounts)]
pub struct ChangePlan<'info> {
    #[account(
        mut,
        seeds = [b"subscription", subscription.token_id.to_le_bytes().as_ref()],
        bump = subscription.bump,
        has_one = owner @ ArcenPayError::Unauthorized,
    )]
    pub subscription: Account<'info, Subscription>,
    #[account(seeds = [b"plan", new_plan.plan_id.to_le_bytes().as_ref()], bump = new_plan.bump)]
    pub new_plan: Account<'info, Plan>,
    pub owner: Signer<'info>,
}

// ─── Session vault (ZKVUB usage billing) ─────────────────────────────────────

#[derive(Accounts)]
pub struct AuthorizeSettler<'info> {
    #[account(has_one = admin @ ArcenPayError::Unauthorized)]
    pub config: Account<'info, Config>,
    #[account(mut)]
    pub admin: Signer<'info>,
    #[account(
        init,
        payer = admin,
        space = 8 + Settler::LEN,
        seeds = [b"settler", settler.key().as_ref()],
        bump,
    )]
    pub settler_record: Account<'info, Settler>,
    /// CHECK: only used to derive the settler PDA seed; not read.
    pub settler: UncheckedAccount<'info>,
    pub system_program: Program<'info, System>,
}

#[derive(Accounts)]
#[instruction(session_id: u64)]
pub struct FundSession<'info> {
    #[account(seeds = [b"config"], bump = config.bump)]
    pub config: Account<'info, Config>,
    /// CHECK: vault authority PDA; only used to authorise vault token transfers.
    #[account(seeds = [b"vault"], bump)]
    pub vault_authority: UncheckedAccount<'info>,
    #[account(mut)]
    pub agent: Signer<'info>,
    #[account(
        init_if_needed,
        payer = agent,
        space = 8 + Session::LEN,
        seeds = [b"session", agent.key().as_ref(), session_id.to_le_bytes().as_ref()],
        bump,
    )]
    pub session: Account<'info, Session>,
    pub token_mint: Box<InterfaceAccount<'info, Mint>>,
    #[account(mut, token::mint = token_mint, token::authority = agent)]
    pub agent_token: Box<InterfaceAccount<'info, TokenAccount>>,
    #[account(mut, token::mint = token_mint, token::authority = vault_authority)]
    pub vault_token: Box<InterfaceAccount<'info, TokenAccount>>,
    pub token_program: Program<'info, Token>,
    pub system_program: Program<'info, System>,
}

#[derive(Accounts)]
#[instruction(amount: u64, call_count: u64, nullifier: [u8; 32])]
pub struct Settle<'info> {
    #[account(seeds = [b"config"], bump = config.bump)]
    pub config: Account<'info, Config>,
    #[account(seeds = [b"settler", settler.key().as_ref()], bump = settler_record.bump)]
    pub settler_record: Account<'info, Settler>,
    #[account(mut)]
    pub settler: Signer<'info>,
    #[account(
        mut,
        seeds = [b"session", session.agent.as_ref(), session.session_id.to_le_bytes().as_ref()],
        bump = session.bump,
    )]
    pub session: Account<'info, Session>,
    /// Replay guard: created on first settlement for this nullifier; a second
    /// settlement with the same nullifier fails (account already initialized).
    #[account(
        init,
        payer = settler,
        space = 8 + NullifierRecord::LEN,
        seeds = [b"nullifier", nullifier.as_ref()],
        bump,
    )]
    pub nullifier_record: Account<'info, NullifierRecord>,
    /// CHECK: vault authority PDA; only used to sign the vault token transfer.
    #[account(seeds = [b"vault"], bump)]
    pub vault_authority: UncheckedAccount<'info>,
    pub token_mint: Box<InterfaceAccount<'info, Mint>>,
    #[account(mut, token::mint = token_mint, token::authority = vault_authority)]
    pub vault_token: Box<InterfaceAccount<'info, TokenAccount>>,
    #[account(mut, token::mint = token_mint)]
    pub provider_token: Box<InterfaceAccount<'info, TokenAccount>>,
    pub token_program: Program<'info, Token>,
    pub system_program: Program<'info, System>,
    /// CHECK: optional Groth16 verifier program; required (and matched against
    /// `config.groth16_verifier`) when proof verification is enabled.
    pub verifier_program: Option<UncheckedAccount<'info>>,
}

#[derive(Accounts)]
pub struct WithdrawSession<'info> {
    #[account(
        mut,
        seeds = [b"session", session.agent.as_ref(), session.session_id.to_le_bytes().as_ref()],
        bump = session.bump,
        has_one = agent @ ArcenPayError::Unauthorized,
    )]
    pub session: Account<'info, Session>,
    pub agent: Signer<'info>,
    /// CHECK: vault authority PDA; only used to sign the vault token transfer.
    #[account(seeds = [b"vault"], bump)]
    pub vault_authority: UncheckedAccount<'info>,
    pub token_mint: Box<InterfaceAccount<'info, Mint>>,
    #[account(mut, token::mint = token_mint, token::authority = vault_authority)]
    pub vault_token: Box<InterfaceAccount<'info, TokenAccount>>,
    #[account(mut, token::mint = token_mint, token::authority = agent)]
    pub agent_token: Box<InterfaceAccount<'info, TokenAccount>>,
    pub token_program: Program<'info, Token>,
}

#[derive(Accounts)]
pub struct SetProofVerification<'info> {
    #[account(
        mut,
        seeds = [b"config"],
        bump = config.bump,
        has_one = admin @ ArcenPayError::Unauthorized,
    )]
    pub config: Account<'info, Config>,
    pub admin: Signer<'info>,
}

#[derive(Accounts)]
#[instruction(token_id: u64, owner: Pubkey)]
pub struct CloseSubscription<'info> {
    #[account(
        seeds = [b"config"],
        bump = config.bump,
        has_one = admin @ ArcenPayError::Unauthorized,
    )]
    pub config: Account<'info, Config>,
    #[account(mut)]
    pub admin: Signer<'info>,
    /// CHECK: closed unconditionally by the handler (raw account, so an account
    /// written by a pre-upgrade layout can still be reclaimed).
    #[account(
        mut,
        seeds = [b"subscription", token_id.to_le_bytes().as_ref()],
        bump,
    )]
    pub subscription: UncheckedAccount<'info>,
    /// CHECK: closed unconditionally by the handler.
    #[account(
        mut,
        seeds = [b"subscription_wallet", owner.as_ref()],
        bump,
    )]
    pub subscription_by_wallet: UncheckedAccount<'info>,
}

#[derive(Accounts)]
pub struct MigrateConfig<'info> {
    /// CHECK: raw Config account — reallocated and re-initialized in the
    /// handler (the new struct no longer fits the old buffer). The admin is
    /// verified against the bytes stored on-chain.
    #[account(mut, seeds = [b"config"], bump)]
    pub config: UncheckedAccount<'info>,
    #[account(mut)]
    pub admin: Signer<'info>,
    pub system_program: Program<'info, System>,
}

// ─── State ──────────────────────────────────────────────────────────────────

#[account]
#[derive(InitSpace)]
pub struct Config {
    pub admin: Pubkey,
    pub treasury: Pubkey,
    pub fee_bps: u64,
    pub plan_count: u64,
    /// When true, `settle` requires a Groth16 proof verified by CPI into the
    /// `groth16_verifier` program. When false, the authorized settler is
    /// trusted (see README).
    pub proof_verification_required: bool,
    /// Verifier program id implementing `verify(proof, public_inputs)`.
    /// `Pubkey::default()` = unset.
    pub groth16_verifier: Pubkey,
    pub bump: u8,
}

impl Config {
    pub const LEN: usize = 32 + 32 + 8 + 8 + 1 + 32 + 1;
}

#[account]
#[derive(InitSpace)]
pub struct Plan {
    pub plan_id: u64,
    pub provider: Pubkey,
    pub price: u64,
    pub billing_interval: i64,
    pub accepted_token: Pubkey,
    pub active: bool,
    pub bump: u8,
}

impl Plan {
    pub const LEN: usize = 8 + 32 + 8 + 8 + 32 + 1 + 1;
}

/// On-chain subscription record. Field order MUST match
/// `decodeSubscriptionRecord` in apps/facilitator/src/services/solana-adapter.ts.
#[account]
#[derive(InitSpace)]
pub struct Subscription {
    pub owner: Pubkey,
    pub token_id: u64,
    pub plan_id: u64,
    pub plan_tier: u8,
    pub expiration: i64,
    pub active: bool,
    pub minted_at: i64,
    pub last_renewed_at: i64,
    pub total_paid: u64,
    /// Immutable per-subscription renewal snapshot. Plan changes may affect
    /// future subscriptions only until the owner explicitly reauthorizes.
    pub renewal_price: u64,
    pub renewal_interval: i64,
    pub accepted_token: Pubkey,
    pub provider: Pubkey,
    pub subscriber_token: Pubkey,
    pub provider_token: Pubkey,
    pub treasury_token: Pubkey,
    pub authorization_expires_at: i64,
    pub remaining_renewals: u16,
    pub autopay_enabled: bool,
    pub delegate_bump: u8,
    pub bump: u8,
}

impl Subscription {
    pub const LEN: usize = 32 + 8 + 8 + 1 + 8 + 1 + 8 + 8 + 8
        + 8 + 8 + 32 + 32 + 32 + 32 + 32 + 8 + 2 + 1 + 1 + 1;
}

#[account]
#[derive(InitSpace)]
pub struct SubscriptionByWallet {
    pub owner: Pubkey,
    pub token_id: u64,
    pub bump: u8,
}

impl SubscriptionByWallet {
    pub const LEN: usize = 32 + 8 + 1;
}

/// Records an address authorized to settle ZKVUB usage sessions.
#[account]
#[derive(InitSpace)]
pub struct Settler {
    pub settler: Pubkey,
    pub bump: u8,
}

impl Settler {
    pub const LEN: usize = 32 + 1;
}

/// A prepaid usage session funded by an agent and drawn down by settlement.
#[account]
#[derive(InitSpace)]
pub struct Session {
    pub agent: Pubkey,
    pub session_id: u64,
    pub token: Pubkey,
    pub balance: u64,
    pub total_funded: u64,
    pub total_settled: u64,
    pub active: bool,
    pub created_at: i64,
    pub bump: u8,
}

impl Session {
    pub const LEN: usize = 32 + 8 + 32 + 8 + 8 + 8 + 1 + 8 + 1;
}

/// Replay guard: records that a settlement nullifier has been used.
#[account]
#[derive(InitSpace)]
pub struct NullifierRecord {
    pub nullifier: [u8; 32],
    pub settled_at: i64,
    pub bump: u8,
}

impl NullifierRecord {
    pub const LEN: usize = 32 + 8 + 1;
}

// ─── Events ─────────────────────────────────────────────────────────────────
//
// Field order is decoded positionally by the facilitator — do not reorder.

#[event]
pub struct SubscriptionMinted {
    pub subscriber: Pubkey,
    pub token_id: u64,
    pub plan_id: u64,
    pub expiration: i64,
}

#[event]
pub struct SubscriptionRenewed {
    pub token_id: u64,
    pub new_expiration: i64,
    pub amount_paid: u64,
}

#[event]
pub struct SubscriptionCancelled {
    pub token_id: u64,
}

#[event]
pub struct SubscriptionPlanChanged {
    pub token_id: u64,
    pub previous_plan_id: u64,
    pub new_plan_id: u64,
    pub expiration: i64,
}

#[event]
pub struct BillingExecuted {
    pub account: Pubkey,
    pub merchant: Pubkey,
    pub token_id: u64,
    pub plan_id: u64,
    pub reason: u8,
    pub gross_amount: u64,
    pub merchant_amount: u64,
    pub protocol_fee: u64,
    pub timestamp: i64,
}

#[event]
pub struct PlanCreated {
    pub plan_id: u64,
    pub provider: Pubkey,
    pub price: u64,
    pub billing_interval: i64,
}

#[event]
pub struct PlanUpdated {
    pub plan_id: u64,
    pub price: u64,
    pub billing_interval: i64,
    pub active: bool,
}

#[event]
pub struct SettlerAuthorized {
    pub settler: Pubkey,
}

#[event]
pub struct SessionFunded {
    pub session_id: u64,
    pub agent: Pubkey,
    pub amount: u64,
    pub balance: u64,
}

#[event]
pub struct SessionWithdrawn {
    pub session_id: u64,
    pub agent: Pubkey,
    pub amount: u64,
    pub balance: u64,
}

/// Settlement event — the Solana analogue of `ZKUsageVerifier.BillingSettled`.
#[event]
pub struct BillingSettled {
    pub session_id: u64,
    pub agent: Pubkey,
    pub call_count: u64,
    pub settlement_amount: u64,
    pub window_start: i64,
    pub window_end: i64,
}

#[event]
pub struct ProofVerificationUpdated {
    pub required: bool,
    pub verifier: Pubkey,
}

// ─── Errors ─────────────────────────────────────────────────────────────────

#[error_code]
pub enum ArcenPayError {
    #[msg("Fee rate exceeds the maximum allowed (1000 bps).")]
    InvalidFeeRate,
    #[msg("Billing interval is below the minimum.")]
    IntervalTooShort,
    #[msg("Plan price must be greater than zero.")]
    InvalidPrice,
    #[msg("Plan is not active.")]
    PlanInactive,
    #[msg("Accepted token does not match the plan.")]
    TokenMismatch,
    #[msg("Payment amount is below the plan price.")]
    InsufficientAmount,
    #[msg("Subscription is not active.")]
    SubscriptionInactive,
    #[msg("Renewal attempted before the minimum interval elapsed.")]
    RenewalTooEarly,
    #[msg("Destination plan is the same as the current plan.")]
    SamePlan,
    #[msg("Signer is not authorized for this action.")]
    Unauthorized,
    #[msg("Usage session is not active.")]
    SessionInactive,
    #[msg("Session balance is too low for this operation.")]
    InsufficientSessionBalance,
    #[msg("Arithmetic overflow.")]
    MathOverflow,
    #[msg("A valid Groth16 proof is required to settle this session.")]
    ProofVerificationRequired,
    #[msg("The provided verifier program does not match the configured verifier.")]
    VerifierMismatch,
    #[msg("The Groth16 proof is invalid.")]
    InvalidProof,
    #[msg("Automatic collection is paused for this subscription.")]
    AutopayDisabled,
    #[msg("The bounded automatic-payment authorization has expired.")]
    AuthorizationExpired,
    #[msg("The bounded automatic-payment authorization is exhausted.")]
    AuthorizationDepleted,
    #[msg("The supplied plan does not match this subscription.")]
    PlanMismatch,
    #[msg("The supplied token account does not match this subscription.")]
    TokenAccountMismatch,
}

// ─── helpers ────────────────────────────────────────────────────────────────

/// CPI into an external Groth16 verifier program.
///
/// The verifier is expected to expose `verify(proof: Vec<u8>,
/// public_inputs: Vec<u8>)` (Anchor discriminator `global:verify`) and to fail
/// its instruction when the proof is invalid. No accounts are forwarded.
fn verify_proof_cpi(
    verifier: &UncheckedAccount<'_>,
    proof: &[u8],
    public_inputs: &[u8],
) -> Result<()> {
    let mut data = Vec::with_capacity(8 + 8 + proof.len() + public_inputs.len());
    let discriminator = anchor_lang::solana_program::hash::hash(b"global:verify").to_bytes();
    data.extend_from_slice(&discriminator[..8]);
    data.extend_from_slice(&(proof.len() as u32).to_le_bytes());
    data.extend_from_slice(proof);
    data.extend_from_slice(&(public_inputs.len() as u32).to_le_bytes());
    data.extend_from_slice(public_inputs);

    let ix = anchor_lang::solana_program::instruction::Instruction {
        program_id: *verifier.key,
        accounts: vec![],
        data,
    };
    anchor_lang::solana_program::program::invoke(&ix, &[verifier.to_account_info()])
        .map_err(|_| ArcenPayError::InvalidProof)?;
    Ok(())
}

/// Splits a gross amount into (merchant_amount, protocol_fee).
fn split_fee(amount: u64, fee_bps: u64) -> Result<(u64, u64)> {
    let fee = amount
        .checked_mul(fee_bps)
        .ok_or(ArcenPayError::MathOverflow)?
        .checked_div(BPS_DENOMINATOR)
        .ok_or(ArcenPayError::MathOverflow)?;
    let merchant = amount
        .checked_sub(fee)
        .ok_or(ArcenPayError::MathOverflow)?;
    Ok((merchant, fee))
}

fn authorization_renewal_count(interval: i64) -> u16 {
    // At least one renewal is available (annual subscriptions); monthly
    // subscriptions receive twelve. The value is intentionally bounded so a
    // delegate approval never becomes an unlimited mandate.
    let cycles = (AUTOPAY_AUTHORIZATION_HORIZON / interval).max(1);
    cycles.min(u16::MAX as i64) as u16
}

/// The SPL delegate allowance to approve: the existing allowance when this
/// program already holds the delegate, plus `additional`; otherwise just
/// `additional` (a foreign delegate is replaced, never inflated).
///
/// An SPL token account has exactly one delegate slot. Deriving the delegate
/// PDA per (owner, mint) makes it shared by every ArcenPay subscription on that
/// token account — so `approve` must be additive, or the second subscription
/// would overwrite the first subscription's remaining renewal budget.
fn delegated_allowance_for(
    token: &InterfaceAccount<TokenAccount>,
    delegate: &Pubkey,
    additional: u64,
) -> Result<u64> {
    let already_ours = match token.delegate {
        COption::Some(existing) => existing == *delegate,
        COption::None => false,
    };
    let base = if already_ours {
        token.delegated_amount
    } else {
        0
    };
    base.checked_add(additional)
        .ok_or_else(|| ArcenPayError::MathOverflow.into())
}

/// CPI helper for a checked SPL transfer authorised by `authority`.
fn transfer_checked<'info>(
    token_program: &Program<'info, Token>,
    from: &InterfaceAccount<'info, TokenAccount>,
    mint: &InterfaceAccount<'info, Mint>,
    to: &InterfaceAccount<'info, TokenAccount>,
    authority: &Signer<'info>,
    amount: u64,
    decimals: u8,
) -> Result<()> {
    let cpi_accounts = TransferChecked {
        from: from.to_account_info(),
        mint: mint.to_account_info(),
        to: to.to_account_info(),
        authority: authority.to_account_info(),
    };
    let cpi_ctx = CpiContext::new(token_program.to_account_info(), cpi_accounts);
    token::transfer_checked(cpi_ctx, amount, decimals)
}

/// CPI helper for a checked SPL transfer signed by a PDA (`authority`).
#[allow(clippy::too_many_arguments)]
fn transfer_checked_signed<'info>(
    token_program: &Program<'info, Token>,
    from: &InterfaceAccount<'info, TokenAccount>,
    mint: &InterfaceAccount<'info, Mint>,
    to: &InterfaceAccount<'info, TokenAccount>,
    authority: &AccountInfo<'info>,
    signer_seeds: &[&[&[u8]]],
    amount: u64,
    decimals: u8,
) -> Result<()> {
    let cpi_accounts = TransferChecked {
        from: from.to_account_info(),
        mint: mint.to_account_info(),
        to: to.to_account_info(),
        authority: authority.clone(),
    };
    let cpi_ctx = CpiContext::new_with_signer(
        token_program.to_account_info(),
        cpi_accounts,
        signer_seeds,
    );
    token::transfer_checked(cpi_ctx, amount, decimals)
}

// ─── Tests ──────────────────────────────────────────────────────────────────

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn fee_split_is_50_bps() {
        // 10 USDC (10_000_000 micros) → 0.5% = 50_000 micros fee.
        let (merchant, fee) = split_fee(10_000_000, SUBSCRIPTION_FEE_BPS).unwrap();
        assert_eq!(fee, 50_000);
        assert_eq!(merchant, 9_950_000);
        assert_eq!(merchant + fee, 10_000_000);
    }

    #[test]
    fn fee_split_zero_amount_is_zero() {
        let (merchant, fee) = split_fee(0, SUBSCRIPTION_FEE_BPS).unwrap();
        assert_eq!((merchant, fee), (0, 0));
    }

    #[test]
    fn fee_split_rounds_down() {
        // 999 * 50 / 10_000 = 4 (4.995 truncated); merchant absorbs the rest.
        let (merchant, fee) = split_fee(999, SUBSCRIPTION_FEE_BPS).unwrap();
        assert_eq!(fee, 4);
        assert_eq!(merchant, 995);
        assert_eq!(merchant + fee, 999);
    }

    #[test]
    fn fee_is_conserved_for_many_amounts() {
        for amount in [1u64, 7, 100, 1_000_000, 12_345_678, 999_999_999] {
            let (merchant, fee) = split_fee(amount, SUBSCRIPTION_FEE_BPS).unwrap();
            assert_eq!(merchant + fee, amount, "amount {amount} not conserved");
            assert!(merchant <= amount);
        }
    }

    #[test]
    fn fee_split_rejects_overflow() {
        assert!(split_fee(u64::MAX, SUBSCRIPTION_FEE_BPS).is_err());
    }

    #[test]
    fn account_space_constants_match_field_layout() {
        // The manual `LEN` constants (used in `space = 8 + X::LEN`) must match
        // the derived `InitSpace` for the same struct — an under-sized constant
        // fails at runtime with `AccountDidNotSerialize`, so compare against the
        // derived value rather than a hand-maintained literal.
        assert_eq!(Config::LEN, Config::INIT_SPACE);
        assert_eq!(Plan::LEN, Plan::INIT_SPACE);
        assert_eq!(Subscription::LEN, Subscription::INIT_SPACE);
        assert_eq!(SubscriptionByWallet::LEN, SubscriptionByWallet::INIT_SPACE);
        assert_eq!(Settler::LEN, Settler::INIT_SPACE);
        assert_eq!(Session::LEN, Session::INIT_SPACE);
        assert_eq!(NullifierRecord::LEN, NullifierRecord::INIT_SPACE);
    }

    #[test]
    fn authorization_renewal_count_is_bounded() {
        // Monthly (30d) grants 12 renewals; annual (365d) grants 1. The value is
        // capped so a delegate approval can never become an unlimited mandate.
        assert_eq!(authorization_renewal_count(MIN_BILLING_INTERVAL), 12);
        assert_eq!(authorization_renewal_count(31_536_000), 1);
        assert_eq!(authorization_renewal_count(1), u16::MAX);
    }

    #[test]
    fn min_billing_interval_is_30_days() {
        assert_eq!(MIN_BILLING_INTERVAL, 30 * 24 * 60 * 60);
    }
}
