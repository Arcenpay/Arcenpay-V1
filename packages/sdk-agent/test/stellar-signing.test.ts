import { describe, it, expect } from "vitest";
import { Keypair } from "@stellar/stellar-sdk";

import { STELLAR_X402_SIGNING_PREFIX } from "../src/agent";

function signStellarPayment(
  keypair: typeof Keypair.prototype,
  message: Record<string, unknown>,
): { signature: string; messageText: string } {
  const messageText =
    STELLAR_X402_SIGNING_PREFIX + JSON.stringify(message);
  const signature = keypair.sign(Buffer.from(messageText, "utf8"));
  return { signature: signature.toString("base64"), messageText };
}

describe("Stellar x402 signing round-trip", () => {
  it("produces a base64 signature that Keypair.verify accepts", () => {
    const kp = Keypair.random();
    const message = {
      from: kp.publicKey(),
      amount: "0.01",
      resource: "https://api.example.com/v1/data",
      sessionId: "sess_123",
      nonce: "0",
      timestamp: String(Date.now()),
      chainId: 9000001,
    };
    const { signature, messageText } = signStellarPayment(kp, message);
    expect(typeof signature).toBe("string");
    expect(signature.length).toBeGreaterThan(0);

    const valid = Keypair.fromPublicKey(kp.publicKey()).verify(
      Buffer.from(messageText, "utf8"),
      Buffer.from(signature, "base64"),
    );
    expect(valid).toBe(true);
  });

  it("rejects a signature from a different key", () => {
    const kp = Keypair.random();
    const other = Keypair.random();
    const message = {
      from: kp.publicKey(),
      amount: "0.01",
      resource: "https://api.example.com/v1/data",
      sessionId: "sess_123",
      nonce: "0",
      timestamp: String(Date.now()),
      chainId: 9000001,
    };
    const { signature, messageText } = signStellarPayment(kp, message);
    const valid = Keypair.fromPublicKey(other.publicKey()).verify(
      Buffer.from(messageText, "utf8"),
      Buffer.from(signature, "base64"),
    );
    expect(valid).toBe(false);
  });

  it("rejects a tampered message", () => {
    const kp = Keypair.random();
    const message = {
      from: kp.publicKey(),
      amount: "0.01",
      resource: "https://api.example.com/v1/data",
      sessionId: "sess_123",
      nonce: "0",
      timestamp: String(Date.now()),
      chainId: 9000001,
    };
    const { signature } = signStellarPayment(kp, message);
    const tampered =
      STELLAR_X402_SIGNING_PREFIX +
      JSON.stringify({ ...message, amount: "99.00" });
    const valid = Keypair.fromPublicKey(kp.publicKey()).verify(
      Buffer.from(tampered, "utf8"),
      Buffer.from(signature, "base64"),
    );
    expect(valid).toBe(false);
  });
});
