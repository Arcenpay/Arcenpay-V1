import { FeeCollected } from '../generated/FeeCollector/FeeCollector';
import { BillingEvent, FeeEvent } from '../generated/schema';
import { eventId } from './common';

export function handleFeeCollected(event: FeeCollected): void {
  const fee = new FeeEvent(eventId(event));
  fee.collector = event.params.from;
  fee.grossAmount = event.params.amount;
  fee.feeAmount = event.params.feeAmount;
  fee.feeType = event.params.feeType;
  fee.txHash = event.transaction.hash;
  fee.blockNumber = event.block.number;
  fee.timestamp = event.block.timestamp;
  fee.save();

  const billing = new BillingEvent(eventId(event));
  billing.eventType = 'protocol.fee_collected';
  billing.amount = event.params.feeAmount;
  billing.actor = event.params.from;
  billing.txHash = event.transaction.hash;
  billing.blockNumber = event.block.number;
  billing.timestamp = event.block.timestamp;
  billing.save();
}
