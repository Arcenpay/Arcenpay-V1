# ArcenPay Incident Runbook

## 1. Smart Contract Emergency

### 1.1 Critical Vulnerability Detected

**Severity**: 🔴 Critical
**Response time**: < 1 hour

1. **Pause affected contracts** (if pausable) via owner multisig
2. Alert team via `#security` channel
3. Run Slither + Mythril against the affected contract:
   ```bash
   cd packages/contracts
   slither . --config-file slither.config.json
   ```
4. Prepare hotfix PR on a private branch
5. Engage audit firm for emergency review if > $100k TVL affected
6. Deploy patched contracts, update ABIs in `@meap/core`
7. Post-mortem within 48h

### 1.2 Subscription NFT Transfer Exploit

**Severity**: 🟠 High

1. Set `globalTransfersEnabled = false` on `SubscriptionTransferPolicy`
2. Review transfer logs from subgraph: filter `SubscriptionMirrored` events
3. Blocklist malicious addresses via `setBlocklist(address, true)`
4. Fix transfer policy rules and re-enable

---

## 2. Cross-Chain Transport Failure

### 2.1 Axelar Gateway Down

**Severity**: 🟠 High  
**Expected**: CCIP fallback auto-activates

1. Verify Axelar status at https://axelarscan.io
2. Check facilitator logs for `CrossChainFallbackTriggered` events
3. If CCIP also failing, queue messages for manual replay
4. Monitor `MirrorRegistry.processedMessages` to verify no duplicate processing
5. Once Axelar recovers, verify pending messages were delivered

### 2.2 GMP Gas Insufficient

**Severity**: 🟡 Medium

1. Check signer balance:
   ```typescript
   const balance = await axelarTransport.getSignerBalance();
   ```
2. Top up signer wallet via team treasury
3. Alert threshold: < 0.01 ETH
4. Critical threshold: < 0.002 ETH (cannot dispatch)

---

## 3. Session Vault Issues

### 3.1 Settlement Failure

**Severity**: 🟠 High

1. Check ZKUsageVerifier for proof rejection reason
2. Verify nullifier hasn't been previously used: `usedNullifiers[nullifier]`
3. Check ProofOrchestrator job history:
   ```typescript
   const jobs = orchestrator.getJobHistory(10);
   ```
4. Retry via `orchestrator.generateAndSubmit(sessionId)` (has built-in idempotency)
5. If circuit issue, regenerate proof with fresh witness

### 3.2 Yield Vault Strategy Failure

**Severity**: 🟠 High

1. Call `withdrawFromStrategy(deployedToStrategy)` to pull all assets back
2. Set `yieldStrategy = address(0)` to prevent further deployment
3. Verify vault `totalAssets()` matches expected
4. All sessions remain functional — only yield generation stops

---

## 4. Dashboard / API Issues

### 4.1 Subgraph Sync Lag

**Severity**: 🟡 Medium

1. Check The Graph hosted service status
2. Verify subgraph health: `_meta { block { number } hasIndexingErrors }`
3. If > 50 blocks behind, check for indexing errors in Graph Explorer
4. Fallback: direct RPC log scanning (slower but complete)

### 4.2 Facilitator Service Down

**Severity**: 🟠 High

1. Check process health: `pm2 status` or container orchestrator
2. Review error logs for crash reason
3. Restart service: `npm run start:facilitator`
4. Verify webhook delivery queue is processing
5. Replay failed webhook deliveries via dashboard

---

## 5. Backup & Restore

### 5.1 Database Backup (Tableland)

- Tableland data is on-chain — inherently backed up by the blockchain
- Export current table state:
  ```bash
  npx @tableland/cli read "SELECT * FROM <table>" --chain sepolia
  ```

### 5.2 Subgraph State Backup

- Subgraph state is derived from on-chain events — can be fully rebuilt
- To rebuild: `npx graph deploy --studio <name>`

### 5.3 Secret Recovery

- Nullifier secrets: stored in `.env` (never committed)
- Signer private keys: stored in `.env` (never committed)
- Recovery procedure: rotate keys via owner multisig, re-authorize new signers

---

## 6. Monitoring Checklist

| Metric                    | Alert Threshold | Action            |
| ------------------------- | --------------- | ----------------- |
| Foundry tests             | Any failure     | Block merge       |
| Slither high findings     | > 0             | Block deploy      |
| CI hygiene gate           | Any marker      | Block merge       |
| GMP signer balance        | < 0.01 ETH      | Top up            |
| Settlement queue depth    | > 100 pending   | Scale settler     |
| Subgraph block lag        | > 50 blocks     | Investigate       |
| Dashboard error rate      | > 5% (Sentry)   | Investigate       |
| Webhook delivery failures | > 10%           | Check facilitator |
