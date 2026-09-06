use soroban_sdk::{Env, contracterror};

#[contracterror]
#[derive(Copy, Clone, Debug, Eq, PartialEq)]
pub enum ArcenPayError {
    NotInitialized = 1,
    AlreadyInitialized = 2,
    NotAuthorized = 3,
    ContractPaused = 4,
    ReentrancyDetected = 5,
    InvalidAmount = 6,
    InvalidAddress = 7,
    InvalidInterval = 8,
    InsufficientBalance = 9,
    PlanNotFound = 10,
    PlanNotActive = 11,
    TokenNotApproved = 12,
    AlreadyExists = 13,
    NotFound = 14,
    AlreadyUsed = 15,
    MigrationFinalized = 16,
    MigrationNotEnabled = 17,
    ProofVerificationFailed = 18,
    NullifierAlreadyUsed = 19,
    InvalidWindow = 20,
    RateNotConfigured = 21,
    InvalidConfig = 22,
    CapExceeded = 23,
    IntervalNotElapsed = 24,
    AccountPaused = 25,
    InvalidSignature = 26,
    ThresholdNotMet = 27,
    MessageAlreadyProcessed = 28,
    StaleUpdate = 29,
    NameTooLong = 30,
    FeatureKeyTooLong = 31,
    ZeroPrice = 32,
    NoSubscription = 33,
    SubscriptionNotActive = 34,
    NotOwner = 35,
    TokenTransferFailed = 36,
    UnauthorizedBiller = 37,
    UnauthorizedSettler = 38,
    ProviderWhitelistRequired = 39,
    InvalidTier = 40,
    FeeRateTooHigh = 41,
}

/// Fail a contract call by emitting a typed `ArcenPayError` code through
/// Soroban's `panic_with_error`. Callers can match on the numeric contract
/// error code returned by the host.
pub fn fail(env: &Env, err: ArcenPayError) -> ! {
    env.panic_with_error(err)
}
