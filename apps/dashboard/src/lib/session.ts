import type { SessionOptions } from "iron-session";

export interface SessionData {
  address: string;
  chainId: number;
  isProvider: boolean;
  nonce: string;
  isLoggedIn: boolean;
}

// iron-session requires a 32+ character password. Use NEXTAUTH_SECRET or
// fall back to a deterministic dev-only password when unset.
const SESSION_PASSWORD =
  process.env.NEXTAUTH_SECRET ||
  "arcenpay-dev-secret-must-be-at-least-32-chars-long";

export const sessionOptions: SessionOptions = {
  password: SESSION_PASSWORD,
  cookieName: "arcenpay-session",
  cookieOptions: {
    secure: process.env.NODE_ENV === "production",
    httpOnly: true,
    sameSite: "lax" as const,
    maxAge: 60 * 60 * 8, // 8 hours
  },
};

export const defaultSession: SessionData = {
  address: "",
  chainId: 0,
  isProvider: false,
  nonce: "",
  isLoggedIn: false,
};
