import test from "node:test";
import assert from "node:assert/strict";
import { STELLAR_TESTNET_CHAIN_ID } from "@arcenpay/internal-core";
import { createResilientFacilitatorClient } from "../src/rpc-client.js";

test("createResilientFacilitatorClient returns a noop client on Stellar chains that safely handles symbol and inspection checks", () => {
  const client = createResilientFacilitatorClient(undefined, STELLAR_TESTNET_CHAIN_ID);

  // Symbol inspection checks should safely return undefined (not throw)
  assert.equal((client as any)[Symbol.toPrimitive], undefined);
  assert.equal((client as any)[Symbol.toStringTag], undefined);

  // Standard inspect / promise / conversion property checks should safely return undefined
  assert.equal((client as any).then, undefined);
  assert.equal((client as any).catch, undefined);
  assert.equal((client as any).finally, undefined);
  assert.equal((client as any).toJSON, undefined);
  assert.equal((client as any).toString, undefined);
  assert.equal((client as any).valueOf, undefined);
  assert.equal((client as any).inspect, undefined);

  // EVM client methods should throw descriptive error
  assert.throws(
    () => {
      (client as any).readContract();
    },
    {
      message:
        "EVM client used on a non-EVM (Stellar) chain. Stellar on-chain reads must go through StellarChainAdapter.",
    },
  );
});
