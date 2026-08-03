/// Shared contract event structs emitted across the ArcenPay protocol.
use soroban_sdk::{Address, String};

#[soroban_sdk::contractevent]
pub struct FeeCollected {
    pub from: Address,
    pub gross_amount: i128,
    pub fee_amount: i128,
    pub fee_type: String,
}

#[soroban_sdk::contractevent]
pub struct AdminUpdated {
    pub previous_admin: Address,
    pub new_admin: Address,
}

#[soroban_sdk::contractevent]
pub struct ContractPaused {}

#[soroban_sdk::contractevent]
pub struct ContractUnpaused {}

#[soroban_sdk::contractevent]
pub struct TreasuryUpdated {
    pub new_treasury: Address,
}

#[soroban_sdk::contractevent]
pub struct FeesWithdrawn {
    pub treasury: Address,
    pub token: Address,
    pub amount: i128,
}

#[soroban_sdk::contractevent]
pub struct InitiatorUnauthorized {
    pub attempted_by: Address,
}

pub fn publish_pause_event(env: &soroban_sdk::Env) {
    ContractPaused {}.publish(env);
}

pub fn publish_unpause_event(env: &soroban_sdk::Env) {
    ContractUnpaused {}.publish(env);
}
