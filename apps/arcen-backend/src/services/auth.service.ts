import {
  normalizeEmail,
  normalizeWalletAddress,
  maskEmail,
  findWalletConflict,
  issueEmailAuthCode,
  getLatestActiveEmailCode,
  verifyEmailAuthCode,
  provisionUserForEmail,
  createTeamInvitation,
  getActiveTeamInvitationByToken,
  acceptTeamInvitation,
} from '../lib/auth/auth-flow';

export class AuthError extends Error {
  constructor(
    message: string,
    public readonly status: number,
    public readonly code: string,
  ) {
    super(message);
    this.name = "AuthError";
  }
}

export class AuthService {
  normalizeEmail(email: string): string {
    return normalizeEmail(email);
  }

  normalizeWalletAddress(address: string): string {
    return normalizeWalletAddress(address);
  }

  maskEmail(email: string): string {
    return maskEmail(email);
  }

  async findWalletConflict(walletAddress: string, attemptEmail: string) {
    return findWalletConflict(walletAddress, attemptEmail);
  }

  async issueEmailAuthCode(email: string, purpose?: string, userId?: string | null) {
    try {
      return await issueEmailAuthCode({ email, purpose, userId });
    } catch (error) {
      throw new AuthError(
        error instanceof Error ? error.message : "Failed to issue auth code",
        500,
        "AUTH_CODE_ISSUE_FAILED",
      );
    }
  }

  async getLatestActiveEmailCode(email: string, purpose?: string) {
    return getLatestActiveEmailCode(email, purpose);
  }

  async verifyEmailAuthCode(email: string, code: string, purpose?: string) {
    return verifyEmailAuthCode({ email, code, purpose });
  }

  async provisionUserForEmail(email: string) {
    try {
      return await provisionUserForEmail(email);
    } catch (error) {
      throw new AuthError(
        error instanceof Error ? error.message : "Failed to provision user",
        500,
        "USER_PROVISION_FAILED",
      );
    }
  }

  async createTeamInvitation(input: {
    teamId: string;
    email: string;
    role: Parameters<typeof createTeamInvitation>[0]["role"];
    invitedByUserId?: string | null;
    inviterEmail?: string | null;
  }) {
    try {
      return await createTeamInvitation(input);
    } catch (error) {
      throw new AuthError(
        error instanceof Error ? error.message : "Failed to create team invitation",
        500,
        "TEAM_INVITE_FAILED",
      );
    }
  }

  async getActiveTeamInvitationByToken(token: string) {
    return getActiveTeamInvitationByToken(token);
  }

  async acceptTeamInvitation(userId: string, token: string) {
    return acceptTeamInvitation(userId, token);
  }
}

export const authService = new AuthService();
