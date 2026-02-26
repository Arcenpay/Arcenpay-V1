import type { SessionOptions } from "iron-session";

export interface SessionData {
  address: string;
  chainId: number;
  isProvider: boolean;
  nonce: string;
  isLoggedIn: boolean;
}

export const sessionOptions: SessionOptions = {
  password: process.env.NEXTAUTH_SECRET as string,
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
