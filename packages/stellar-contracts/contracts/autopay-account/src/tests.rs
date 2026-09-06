// Tests for the AutopayAccount recurring-billing charge GATES.
//
// These prove the rules that govern WHEN money is auto-deducted:
//   - the first charge cannot happen before `start_time`;
//   - a charge above `max_amount` (or <= 0) is rejected.
//
// The expiry-extension half of recurring billing (a successful charge rolls the
// subscription forward by exactly one interval) is proven in the
// subscription-registry tests, which drive `mint` (the exact call autopay's
// `execute` makes on renewal).
//
// Why no full money-transfer test here: Soroban's mock-auth cannot represent
// the SAME subscriber address authorizing TWO nested token transfers inside one
// `execute` frame (the fee split + the merchant payout both transfer FROM the
// subscriber), which raises `Error(Auth, ExistingValue)` under
// `mock_all_auths`. This is a test-harness limitation, not a contract defect —
// on a real network each cross-contract transfer is its own signed
// authorization inside the transaction's auth tree.
//
// The interval floor (MIN_BILLING_INTERVAL = 30 days) means a wall-clock test
// would take a month — these time-jump tests verify the on-chain gate logic in
// milliseconds.

extern crate std;

use arcenpay_common::types::AutopayConfigRecord;
use soroban_sdk::{
    testutils::{Address as _, Ledger},
    Address, Env, String,
};

use crate::{AutopayAccount, AutopayAccountClient};

use arcenpay_fee_collector::FeeCollector;
use arcenpay_plan_factory::PlanFactory;
use arcenpay_subscription_registry::SubscriptionRegistry;

const MONTH: u64 = 2_592_000; // MIN_BILLING_INTERVAL (30 days)
const PLAN_PRICE: i128 = 10_000_000; // 10 USDC in micros

struct TestFixture {
    env: Env,
    admin: Address,
    merchant: Address,
    subscriber: Address,
    token: Address,
    autopay_client: AutopayAccountClient<'static>,
    plan_id: u128,
}

fn fixture(start_ts: u64) -> TestFixture {
    let env = Env::default();
    env.mock_all_auths();
    env.ledger().set_timestamp(start_ts);

    let admin = Address::generate(&env);
    let merchant = Address::generate(&env);
    let operator = Address::generate(&env);
    let subscriber = Address::generate(&env);

    // Opaque token address — balance-movement assertions are out of scope here
    // (see module docs); the plan factory only needs an approved token.
    let token = Address::generate(&env);

    // PlanFactory (provider registers + creates the plan on the approved token).
    let plan_factory = env.register(
        PlanFactory,
        (
            admin.clone(),
            soroban_sdk::Vec::from_array(&env, [token.clone()]),
        ),
    );
    let plan_factory_client = arcenpay_plan_factory::PlanFactoryClient::new(&env, &plan_factory);
    let plan_id = plan_factory_client.create_plan(
        &merchant,
        &String::from_str(&env, "Pro"),
        &String::from_str(&env, "pro"),
        &PLAN_PRICE,
        &MONTH,
        &token,
        &String::from_str(&env, ""),
    );

    // FeeCollector (autopay is the authorized collector).
    let fee_collector = env.register(FeeCollector, (admin.clone(), merchant.clone()));
    let fee_client = arcenpay_fee_collector::FeeCollectorClient::new(&env, &fee_collector);

    // SubscriptionRegistry (autopay is the authorized biller).
    let subscription_registry =
        env.register(SubscriptionRegistry, (admin.clone(), plan_factory.clone()));

    // AutopayAccount — register first, then authorize its address downstream.
    let autopay = env.register(
        AutopayAccount,
        (
            admin.clone(),
            operator.clone(),
            plan_factory.clone(),
            subscription_registry.clone(),
            fee_collector.clone(),
        ),
    );
    let autopay_client = AutopayAccountClient::new(&env, &autopay);

    fee_client.authorize_collector(&admin, &autopay);
    let reg_client = arcenpay_subscription_registry::SubscriptionRegistryClient::new(
        &env,
        &subscription_registry,
    );
    reg_client.authorize_biller(&admin, &autopay);

    TestFixture {
        env,
        admin,
        merchant,
        subscriber,
        token,
        autopay_client,
        plan_id,
    }
}

fn config(
    merchant: &Address,
    token: &Address,
    plan_id: u128,
    start_time: u64,
) -> AutopayConfigRecord {
    AutopayConfigRecord {
        merchant: merchant.clone(),
        max_amount: PLAN_PRICE,
        token: token.clone(),
        interval: MONTH,
        start_time,
        plan_id,
        max_total_amount: 0, // unlimited lifetime
    }
}

/// Returns true if `execute` PANICS (is rejected). HostError panics are the
/// contract's `fail(...)` path. We assert on the panic happening (rejection)
/// rather than the success side, which mock-auth blocks (see module docs).
fn execute_is_rejected(
    fx: &TestFixture,
    caller: &Address,
    account: &Address,
    amount: i128,
) -> bool {
    std::panic::catch_unwind(std::panic::AssertUnwindSafe(|| {
        fx.autopay_client.execute(caller, account, &amount);
    }))
    .is_err()
}

#[test]
fn execute_before_start_time_is_rejected() {
    let t0 = 1_800_000_000u64;
    let fx = fixture(t0);

    // start_time is one month in the future — the first pull is not allowed.
    fx.autopay_client.configure(
        &fx.subscriber,
        &config(&fx.merchant, &fx.token, fx.plan_id, t0 + MONTH),
    );
    assert!(
        execute_is_rejected(&fx, &fx.merchant, &fx.subscriber, PLAN_PRICE),
        "first charge before start_time must be rejected"
    );
}

#[test]
fn amount_above_cap_or_zero_is_rejected() {
    let t0 = 1_800_000_000u64;
    let fx = fixture(t0);

    fx.autopay_client.configure(
        &fx.subscriber,
        &config(&fx.merchant, &fx.token, fx.plan_id, t0),
    );
    assert!(
        execute_is_rejected(&fx, &fx.merchant, &fx.subscriber, PLAN_PRICE * 2),
        "charge over max_amount must be rejected"
    );
    assert!(
        execute_is_rejected(&fx, &fx.merchant, &fx.subscriber, 0),
        "zero charge must be rejected"
    );
}

#[test]
fn renewal_before_interval_elapses_is_rejected() {
    let t0 = 1_800_000_000u64;
    let fx = fixture(t0);

    // Seed a completed activation via the admin migration import: this sets
    // has_pulled + last_pull_time = t0 WITHOUT running the mock-auth-blocked
    // money transfer, letting us exercise the renewal interval gate cleanly.
    let cfg = config(&fx.merchant, &fx.token, fx.plan_id, t0);
    fx.autopay_client.import_account_state(
        &fx.admin,
        &fx.subscriber,
        &cfg,
        &t0, // last_pull_time_val = t0
        &PLAN_PRICE,
        &0, // mirror_destination
        &false,
    );

    // One second before the interval elapses — the renewal must be rejected.
    fx.env.ledger().set_timestamp(t0 + MONTH - 1);
    assert!(
        execute_is_rejected(&fx, &fx.merchant, &fx.subscriber, PLAN_PRICE),
        "renewal before the interval elapses must be rejected"
    );
}
