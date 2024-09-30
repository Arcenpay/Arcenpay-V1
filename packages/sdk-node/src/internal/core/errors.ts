// ============================================================
//  ArcenPay Internal Core — Contract Error Mapping
//  Human-readable error messages for Solidity revert reasons
//  PRD §3.4 — Error Message Mapping
// ============================================================

/**
 * Maps Solidity revert reason strings to human-readable messages.
 * Used by TransactionFlow and SDK error handlers.
 */
export const CONTRACT_ERRORS: Record<string, string> = {
    // SubscriptionRegistry errors
    NotSubscribed: 'Your wallet does not have an active subscription.',
    SubscriptionExpired: 'Your subscription has expired. Please renew to continue.',
    AlreadySubscribed: 'This wallet already has an active subscription.',
    InvalidTokenId: 'The subscription token ID is invalid.',
    NotTokenOwner: 'You are not the owner of this subscription token.',
    SubscriptionNotExpired: 'Cannot cancel — the subscription is still active.',

    // PlanFactory errors
    PlanNotFound: 'This plan no longer exists or has been deactivated.',
    PlanNotActive: 'This plan is not currently accepting new subscribers.',
    InvalidPlanConfig: 'The plan configuration is invalid. Please check your inputs.',
    PlanAlreadyExists: 'A plan with this ID already exists.',
    NotPlanProvider: 'Only the plan provider can perform this action.',

    // ERC7579AutopayModule errors
    ModuleAlreadyInstalled: 'Autopay is already set up for this provider.',
    ModuleNotInstalled: 'The autopay module is not installed on this account.',
    IntervalNotElapsed: 'The billing interval has not elapsed yet.',
    ExceedsMaxAmount: 'The payment amount exceeds the authorized maximum.',
    UnauthorizedMerchant: 'This merchant is not authorized to pull payments.',
    InvalidToken: 'The payment token is not on the approved list.',

    // SessionVault errors
    InsufficientBalance: 'Your session vault balance is too low. Please deposit more USDC.',
    SessionNotFound: 'The session was not found.',
    SessionNotActive: 'This session is no longer active.',
    InsufficientDeposit: 'The deposit amount is below the minimum required.',
    WithdrawExceedsBalance: 'Cannot withdraw more than the available balance.',

    // ZKUsageVerifier errors
    NullifierUsed: 'This usage proof has already been submitted.',
    InvalidProof: 'The zk-SNARK proof is invalid.',
    WindowExpired: 'The billing window has already closed.',
    InvalidPublicInputs: 'The proof public inputs do not match expectations.',

    // FeeCollector errors
    InsufficientFees: 'Insufficient protocol fees to collect.',
    NotAuthorized: 'You are not authorized to perform this action.',

    // General ERC-20 errors
    ERC20InsufficientAllowance: 'USDC allowance is too low. Please approve a higher amount.',
    ERC20InsufficientBalance: 'Your wallet does not have enough USDC.',

    // General errors
    Unauthorized: 'You are not authorized to perform this action.',
    Paused: 'The contract is currently paused.',
    ZeroAddress: 'Cannot use the zero address.',
    InvalidAmount: 'The amount provided is invalid.',
};

/**
 * Parse a contract revert error into a human-readable message
 */
export function parseContractError(error: unknown): string {
    if (!error) return 'An unknown error occurred.';

    const errorString = typeof error === 'string' ? error : (error as Error).message || '';

    // Check for known revert reason strings
    for (const [key, message] of Object.entries(CONTRACT_ERRORS)) {
        if (errorString.includes(key)) {
            return message;
        }
    }

    // Check for common patterns
    if (errorString.includes('user rejected') || errorString.includes('User denied')) {
        return 'Transaction was rejected in your wallet.';
    }
    if (errorString.includes('insufficient funds')) {
        return 'Insufficient ETH for gas fees.';
    }
    if (errorString.includes('nonce too low')) {
        return 'Transaction nonce conflict. Please try again.';
    }
    if (errorString.includes('execution reverted')) {
        const match = errorString.match(/execution reverted: (.+?)(?:\n|$|")/);
        return match?.[1] || 'Transaction reverted on-chain.';
    }

    // Truncate if too long
    if (errorString.length > 150) {
        return errorString.slice(0, 147) + '...';
    }

    return errorString || 'An unknown error occurred.';
}

export type ArcenPayErrorCode =
    | 'UNKNOWN'
    | 'CONTRACT_REVERT'
    | 'WALLET_REJECTED'
    | 'INSUFFICIENT_FUNDS'
    | 'INVALID_INPUT'
    | 'UNAUTHORIZED'
    | 'NETWORK_ERROR';

/** @deprecated Use ArcenPayErrorCode */
export type MEAPErrorCode = ArcenPayErrorCode;

export class ArcenPayError extends Error {
    code: ArcenPayErrorCode;
    cause?: unknown;
    details?: Record<string, unknown>;

    constructor(
        message: string,
        code: ArcenPayErrorCode = 'UNKNOWN',
        options?: { cause?: unknown; details?: Record<string, unknown> },
    ) {
        super(message);
        this.name = 'ArcenPayError';
        this.code = code;
        this.cause = options?.cause;
        this.details = options?.details;
    }
}

export class ContractError extends ArcenPayError {
    constructor(message: string, options?: { cause?: unknown; details?: Record<string, unknown> }) {
        super(message, 'CONTRACT_REVERT', options);
        this.name = 'ContractError';
    }
}

export class AuthError extends ArcenPayError {
    constructor(message: string, options?: { cause?: unknown; details?: Record<string, unknown> }) {
        super(message, 'UNAUTHORIZED', options);
        this.name = 'AuthError';
    }
}

export function normalizeError(error: unknown): ArcenPayError {
    if (error instanceof ArcenPayError) return error;

    const message = typeof error === 'string' ? error : (error as Error)?.message || 'Unknown error';
    const lower = message.toLowerCase();

    if (lower.includes('user rejected') || lower.includes('user denied')) {
        return new ArcenPayError('Transaction was rejected in your wallet.', 'WALLET_REJECTED', {
            cause: error,
        });
    }

    if (lower.includes('insufficient funds')) {
        return new ArcenPayError('Insufficient ETH for gas fees.', 'INSUFFICIENT_FUNDS', {
            cause: error,
        });
    }

    if (lower.includes('execution reverted') || lower.includes('revert')) {
        return new ContractError(parseContractError(error), { cause: error });
    }

    return new ArcenPayError(message, 'UNKNOWN', { cause: error });
}

/** @deprecated Use ArcenPayError */
export const MEAPError = ArcenPayError;
