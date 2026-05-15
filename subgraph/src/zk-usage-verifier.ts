import {
  BillingSettled,
} from '../generated/ZKUsageVerifier/ZKUsageVerifier';
import { BillingEvent, ProofSubmission, Settlement } from '../generated/schema';
import { eventId, getOrCreateSession, getOrCreateStats } from './common';

export function handleBillingSettled(event: BillingSettled): void {
  const session = getOrCreateSession(event.params.sessionId, event.params.agentAddress);
  session.totalSettled = session.totalSettled.plus(event.params.settlementAmount);
  if (session.currentBalance >= event.params.settlementAmount) {
    session.currentBalance = session.currentBalance.minus(event.params.settlementAmount);
  } else {
    session.currentBalance = BigInt.fromI32(0);
  }
  session.save();

  const settlement = new Settlement(eventId(event));
  settlement.session = session.id;
  settlement.sessionId = event.params.sessionId;
  settlement.agentAddress = event.params.agentAddress;
  settlement.callCount = event.params.callCount;
  settlement.settlementAmount = event.params.settlementAmount;
  settlement.windowStart = event.params.windowStart;
  settlement.windowEnd = event.params.windowEnd;
  settlement.txHash = event.transaction.hash;
  settlement.blockNumber = event.block.number;
  settlement.timestamp = event.block.timestamp;
  settlement.save();

  const proof = new ProofSubmission(
    event.params.sessionId.toHexString() + '-' + event.params.windowEnd.toString()
  );
  proof.sessionId = event.params.sessionId;
  proof.agentAddress = event.params.agentAddress;
  proof.callCount = event.params.callCount;
  proof.settlementAmount = event.params.settlementAmount;
  proof.windowStart = event.params.windowStart;
  proof.windowEnd = event.params.windowEnd;
  proof.txHash = event.transaction.hash;
  proof.timestamp = event.block.timestamp;
  proof.save();

  const stats = getOrCreateStats();
  stats.totalSettlements += 1;
  stats.totalSettlementVolume = stats.totalSettlementVolume.plus(event.params.settlementAmount);
  stats.save();

  const billing = new BillingEvent(eventId(event));
  billing.eventType = 'proof.settled';
  billing.sessionId = event.params.sessionId;
  billing.amount = event.params.settlementAmount;
  billing.txHash = event.transaction.hash;
  billing.blockNumber = event.block.number;
  billing.timestamp = event.block.timestamp;
  billing.save();
}
