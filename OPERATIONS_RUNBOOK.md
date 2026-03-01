# ArcenPay Operations Runbook

This runbook covers the highest-risk on-call scenarios from the PRD for MEAP + ZKVUB.

## 1) Proof Stuck (Aggregation/Settlement Delay)

### Detection
- Facilitator `/api/aggregator/stats` queue depth keeps rising.
- `/metrics` shows elevated `aggregator_queue_depth` and no increase in `x402_requests_total` to settlement ratio.
- No recent `BillingSettled` events from `ZKUsageVerifier`.

### Immediate Checks
1. Check facilitator health: `GET /health`.
2. Check settlement authorization: `GET /api/ops/settlement/status`.
3. Check proof runtime config: `GET /api/ops/proof/runtime`.
4. Confirm `PROOF_MODE=strict` in production and verify proof artifacts:
   - `ZK_CIRCUIT_WASM_PATH`
   - `ZK_CIRCUIT_ZKEY_PATH`
   - `ZK_CIRCUIT_VKEY_PATH`
5. Confirm `SESSION_VAULT_ADDRESS` and `PRIVATE_KEY` are correct in facilitator env.
6. Verify SessionVault settler authorization for facilitator wallet.

### Remediation
1. If unauthorized settler: run
   - `npm --workspace @meap/contracts run ops:authorize-facilitator:settler`
2. If Redis unavailable: restore Redis and confirm `REDIS_URL` connectivity.
3. If queue is stale: restart facilitator process and monitor queue drain.
4. If proofs are malformed: quarantine affected batches and re-generate proof inputs.

### Exit Criteria
- New `BillingSettled` events observed.
- Queue depth stabilizes/decreases.
- Settlement tx hashes visible in facilitator usage APIs.

## 2) GMP Message Delayed (Cross-Chain Sync)

### Detection
- Primary chain renewals/mints succeed, mirror chain access stale.
- Mirror events not emitted on destination chain.

### Immediate Checks
1. Confirm `SubscriptionRegistry` dispatch path is configured:
   - `axelarTransport` set (primary)
   - `ccipTransport` set (fallback)
2. Verify mirror route contracts:
   - `MirrorRegistry.axelarGateway`
   - `MirrorRegistry.ccipRouter`
   - `MirrorRegistry.trustedSources[sourceChainId]`
3. Check source-chain dispatch/fallback events:
   - `CrossChainDispatchRequested`
   - `CrossChainFallbackTriggered`
4. Check destination-chain duplicate suppression state:
   - `MirrorRegistry.processedMessages(messageId)`

### Remediation
1. If Axelar path fails, ensure CCIP fallback transport is configured.
2. If trusted source mismatch, update trusted source bytes via owner call.
3. If message replay/duplicate issue, inspect `messageId` collisions in relayer.
4. If transport adapter outage, pause dispatch and replay queued payloads after recovery.

### Exit Criteria
- `SubscriptionMirrored` events emitted on destination chain.
- Mirror expiry and plan fields match source chain.

## 3) Facilitator Down or Unhealthy

### Detection
- `/health` fails or reports non-healthy dependencies.
- `/metrics` unavailable.
- x402 protected endpoints deny all traffic.

### Immediate Checks
1. Container/process status and restart count.
2. RPC reachability and chain head progress.
3. Redis connectivity.
4. Signer wallet balance for gas.

### Remediation
1. Restart facilitator service.
2. If config drift, re-deploy with known-good env set.
3. If chain RPC degraded, switch to backup RPC provider.
4. If key compromised/suspected, rotate facilitator signer and re-authorize settler.

### Exit Criteria
- `/health` returns status `ok` with chain data.
- `/metrics` scraping resumes.
- x402 route success rate and settlement latency return to baseline.

## 4) Post-Incident Checklist

1. Export relevant tx hashes, logs, and metric screenshots.
2. Add incident summary, timeline, root cause, and action items.
3. Create regression tests (contract/integration) for the triggering condition.
4. Update this runbook if any command or endpoint changed.
