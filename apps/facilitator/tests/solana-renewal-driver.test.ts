import assert from "node:assert/strict";
import test from "node:test";
import { Keypair } from "@solana/web3.js";
import {
  isRenewalDue,
  parseSubscriberKeys,
} from "../src/services/solana-renewal-driver.js";

test("isRenewalDue compares expiration against now", () => {
  const now = 1_700_000_000;
  assert.equal(isRenewalDue(BigInt(now - 1), now), true);
  assert.equal(isRenewalDue(BigInt(now), now), true);
  assert.equal(isRenewalDue(BigInt(now + 1), now), false);
  assert.equal(isRenewalDue(0n, now), true);
});

test("parseSubscriberKeys parses base58 <pubkey>:<secret> entries", () => {
  const kp = Keypair.generate();
  // base58-encode the secret key (64 bytes) via a minimal encoder.
  const ALPHABET = "123456789ABCDEFGHJKLMNPQRSTUVWXYZabcdefghijkmnopqrstuvwxyz";
  let num = 0n;
  for (const b of kp.secretKey) num = num * 256n + BigInt(b);
  let secret = "";
  while (num > 0n) {
    secret = ALPHABET[Number(num % 58n)] + secret;
    num /= 58n;
  }
  for (let i = 0; i < kp.secretKey.length && kp.secretKey[i] === 0; i += 1) {
    secret = "1" + secret;
  }

  const map = parseSubscriberKeys(`${kp.publicKey.toBase58()}:${secret}`);
  assert.equal(map.size, 1);
  assert.ok(map.has(kp.publicKey.toBase58()));
});

test("parseSubscriberKeys accepts JSON-array secrets and skips bad entries", () => {
  const kp = Keypair.generate();
  const jsonSecret = JSON.stringify(Array.from(kp.secretKey));
  const map = parseSubscriberKeys(
    `; garbage; ${kp.publicKey.toBase58()}:${jsonSecret}; ::`,
  );
  assert.equal(map.size, 1);
  assert.equal(parseSubscriberKeys(undefined).size, 0);
  assert.equal(parseSubscriberKeys("").size, 0);
});
