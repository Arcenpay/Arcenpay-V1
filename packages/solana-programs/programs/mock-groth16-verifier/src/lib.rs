//! Test-only mock Groth16 verifier.
//!
//! Implements the same verifier-program convention that `settle` CPI-calls into,
//! so the proof gate can be exercised end to end without running real BN254
//! pairing:
//!
//!   data = discriminator(8)          // sha256("global:verify")[..8]
//!        + borsh Vec<u8> proof       // u32 LE length + bytes
//!        + borsh Vec<u8> public_inputs
//!
//! It accepts iff `proof == b"valid"`. This is a fixture, never deployed; a
//! production verifier (e.g. a `groth16-solana`-based program) implements the
//! identical interface with real pairing checks.

use solana_program::{
    account_info::AccountInfo,
    entrypoint::ProgramResult,
    hash::hash,
    msg,
    program_error::ProgramError,
    pubkey::Pubkey,
};

pub fn process_instruction(
    _program_id: &Pubkey,
    _accounts: &[AccountInfo],
    data: &[u8],
) -> ProgramResult {
    let expected = hash(b"global:verify").to_bytes();
    if data.len() < 8 || data[..8] != expected[..8] {
        msg!("mock-verifier: unknown instruction");
        return Err(ProgramError::InvalidInstructionData);
    }

    let mut offset = 8usize;
    let proof = read_vec(data, &mut offset)?;
    let _public_inputs = read_vec(data, &mut offset)?;

    if proof == b"valid".as_slice() {
        Ok(())
    } else {
        msg!("mock-verifier: proof rejected");
        Err(ProgramError::Custom(1))
    }
}

fn read_vec<'a>(data: &'a [u8], offset: &mut usize) -> Result<&'a [u8], ProgramError> {
    if data.len() < *offset + 4 {
        return Err(ProgramError::InvalidInstructionData);
    }
    let len = u32::from_le_bytes(data[*offset..*offset + 4].try_into().unwrap()) as usize;
    *offset += 4;
    if data.len() < *offset + len {
        return Err(ProgramError::InvalidInstructionData);
    }
    let slice = &data[*offset..*offset + len];
    *offset += len;
    Ok(slice)
}
