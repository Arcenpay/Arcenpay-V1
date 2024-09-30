import { Hono } from "hono";
import { getNonce } from "./nonce.js";
import { getSession, createSession } from "./session.js";
import { clearSessionHandler } from "./logout.js";
import { startEmail } from "./email-start.js";
import { verifyEmail } from "./email-verify.js";
import { linkWallet } from "./link-wallet.js";
import { walletStatus } from "./wallet-status.js";

export const authRoutes = new Hono()
  .get("/nonce", getNonce)
  .get("/session", getSession)
  .post("/session", createSession)
  .post("/logout", clearSessionHandler)
  .post("/email/start", startEmail)
  .post("/email/verify", verifyEmail)
  .post("/link-wallet", linkWallet)
  .get("/wallet-status", walletStatus);
