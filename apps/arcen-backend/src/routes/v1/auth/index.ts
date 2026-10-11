import { Hono } from "hono";
import { getNonce } from "./nonce.js";
import { getSession } from "./session.js";
import { clearSessionHandler } from "./logout.js";
import { startEmail } from "./email-start.js";
import { verifyEmail } from "./email-verify.js";
import { linkWallet } from "./link-wallet.js";
import { walletStatus } from "./wallet-status.js";

export const authRoutes = new Hono()
  .get("/nonce", getNonce)
  .get("/session", getSession)
  // NOTE: session creation is NOT exposed here. A session is minted only by
  // `POST /auth/email/verify` after the emailed code is proven, or by a wallet
  // signature flow. An anonymous `POST /session { userId }` would let anyone
  // mint a cookie for an arbitrary user (account takeover).
  .post("/logout", clearSessionHandler)
  .post("/email/start", startEmail)
  .post("/email/verify", verifyEmail)
  .post("/link-wallet", linkWallet)
  .get("/wallet-status", walletStatus);
