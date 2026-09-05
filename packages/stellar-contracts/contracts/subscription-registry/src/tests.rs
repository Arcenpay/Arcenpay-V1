// Tests for the SubscriptionRegistry renewal logic.
//
// These prove the "expiration extends after a duration" half of recurring
// billing: minting a subscription, then renewing the same plan extends the
// SAME token's expiration by exactly one interval (never minting a second
// token), renewing after expiry restarts from now, and switching plans while
// active is rejected.

extern crate std;

use soroban_sdk::{
    testutils::{Address as _, Ledger},
    Address, Env, String,
};

use arcenpay_plan_factory::PlanFactory;
use crate::{SubscriptionRegistry, SubscriptionRegistryClient};

const MONTH: u64 = 2_592_000; // MIN_BILLING_INTERVAL (30 days)
const PLAN_PRICE: i128 = 10_000_000; // 10 USDC in micros

struct Fixture {
    env: Env,
    subscriber: Address,
    biller: Address,
    registry_client: SubscriptionRegistryClient<'static>,
    plan_id: u128,
    plan2_id: u128,
}

fn fixture(start_ts: u64) -> Fixture {
    let env = Env::default();
    env.mock_all_auths();
    env.ledger().set_timestamp(start_ts);

    let admin = Address::generate(&env);
    let provider = Address::generate(&env);
    let subscriber = Address::generate(&env);
    let biller = Address::generate(&env);
    // Accepted-token address: an opaque address is enough — the registry never
    // moves tokens, it only reads plan tier/active from the factory.
    let usdc = Address::generate(&env);

    let plan_factory = env.register(
        PlanFactory,
        (
            admin.clone(),
            soroban_sdk::Vec::from_array(&env, [usdc.clone()]),
        ),
    );
    let pf = arcenpay_plan_factory::PlanFactoryClient::new(&env, &plan_factory);
    let plan_id = pf.create_plan(
        &provider,
        &String::from_str(&env, "Pro"),
        &String::from_str(&env, "pro"),
        &PLAN_PRICE,
        &MONTH,
        &usdc,
        &String::from_str(&env, ""),
    );
    let plan2_id = pf.create_plan(
        &provider,
        &String::from_str(&env, "Plus"),
        &String::from_str(&env, "plus"),
        &PLAN_PRICE,
        &MONTH,
        &usdc,
        &String::from_str(&env, ""),
    );

    let registry = env.register(SubscriptionRegistry, (admin.clone(), plan_factory.clone()));
    let registry_client = SubscriptionRegistryClient::new(&env, &registry);
    registry_client.authorize_biller(&admin, &biller);

    Fixture {
        env,
        subscriber,
        biller,
        registry_client,
        plan_id,
        plan2_id,
    }
}

#[test]
fn mint_first_token_then_renew_same_plan_extends_same_token() {
    let t0 = 1_800_000_000u64;
    let fx = fixture(t0);

    let token_id = fx.registry_client.mint(
        &fx.biller,
        &fx.subscriber,
        &fx.plan_id,
        &MONTH,
        &PLAN_PRICE,
    );
    let sub = fx
        .registry_client
        .get_subscription(&token_id);
    assert_eq!(sub.expiration, t0 + MONTH);
    assert_eq!(sub.total_paid, PLAN_PRICE);
    assert!(sub.active);

    // Renew the SAME plan → same token id, expiration extends by one interval.
    fx.env.ledger().set_timestamp(t0 + MONTH);
    let renewed_id = fx.registry_client.mint(
        &fx.biller,
        &fx.subscriber,
        &fx.plan_id,
        &MONTH,
        &PLAN_PRICE,
    );
    assert_eq!(renewed_id, token_id, "renewal must reuse the token");

    let renewed = fx.registry_client.get_subscription(&token_id);
    assert_eq!(renewed.expiration, t0 + 2 * MONTH);
    assert_eq!(renewed.total_paid, 2 * PLAN_PRICE);
    assert_eq!(renewed.last_renewed_at, t0 + MONTH);
    assert!(renewed.active);
}

#[test]
fn wallet_has_exactly_one_subscription_after_renewals() {
    let t0 = 1_800_000_000u64;
    let fx = fixture(t0);

    fx.registry_client.mint(&fx.biller, &fx.subscriber, &fx.plan_id, &MONTH, &PLAN_PRICE);
    fx.env.ledger().set_timestamp(t0 + MONTH);
    fx.registry_client.mint(&fx.biller, &fx.subscriber, &fx.plan_id, &MONTH, &PLAN_PRICE);
    fx.env.ledger().set_timestamp(t0 + 2 * MONTH);
    fx.registry_client.mint(&fx.biller, &fx.subscriber, &fx.plan_id, &MONTH, &PLAN_PRICE);

    let sub = fx
        .registry_client
        .get_subscription_by_wallet(&fx.subscriber)
        .expect("subscriber has exactly one subscription");
    assert_eq!(sub.expiration, t0 + 3 * MONTH);
    assert_eq!(sub.total_paid, 3 * PLAN_PRICE);
}

#[test]
fn renew_after_expiry_restarts_from_now() {
    let t0 = 1_800_000_000u64;
    let fx = fixture(t0);

    let token_id = fx.registry_client.mint(
        &fx.biller,
        &fx.subscriber,
        &fx.plan_id,
        &MONTH,
        &PLAN_PRICE,
    );
    assert_eq!(
        fx.registry_client.get_subscription(&token_id).expiration,
        t0 + MONTH
    );

    // Let the subscription lapse by more than a full interval, then renew.
    let lapse_ts = t0 + 3 * MONTH + 100;
    fx.env.ledger().set_timestamp(lapse_ts);
    fx.registry_client.mint(&fx.biller, &fx.subscriber, &fx.plan_id, &MONTH, &PLAN_PRICE);

    // Expiration restarts from NOW, not compounding from the old expiry.
    let renewed = fx.registry_client.get_subscription(&token_id);
    assert_eq!(renewed.expiration, lapse_ts + MONTH);
    assert!(renewed.active);
}

#[test]
fn switching_plan_while_active_is_rejected() {
    let t0 = 1_800_000_000u64;
    let fx = fixture(t0);

    fx.registry_client.mint(&fx.biller, &fx.subscriber, &fx.plan_id, &MONTH, &PLAN_PRICE);

    let result = std::panic::catch_unwind(std::panic::AssertUnwindSafe(|| {
        fx.registry_client.mint(
            &fx.biller,
            &fx.subscriber,
            &fx.plan2_id,
            &MONTH,
            &PLAN_PRICE,
        );
    }));
    assert!(result.is_err(), "switching plans while active must fail");
}

#[test]
fn non_biller_cannot_mint() {
    let t0 = 1_800_000_000u64;
    let fx = fixture(t0);
    let stranger = Address::generate(&fx.env);

    let result = std::panic::catch_unwind(std::panic::AssertUnwindSafe(|| {
        fx.registry_client.mint(
            &stranger,
            &fx.subscriber,
            &fx.plan_id,
            &MONTH,
            &PLAN_PRICE,
        );
    }));
    assert!(result.is_err(), "non-biller mint must fail");
}
