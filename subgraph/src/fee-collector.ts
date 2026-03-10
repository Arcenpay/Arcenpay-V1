import {
  FeeCollected,
  ProviderTierSynced,
  ProviderFeeRateSet,
} from '../generated/FeeCollector/FeeCollector';
import { BillingEvent, FeeEvent, ProviderTierChange } from '../generated/schema';
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

export function handleProviderTierSynced(event: ProviderTierSynced): void {
  const change = new ProviderTierChange(eventId(event));
  change.provider = event.params.provider;
  change.tier = event.params.tier;
  change.subFeeBps = event.params.subFeeBps;
  change.settleFeeBps = event.params.settleFeeBps;
  change.txHash = event.transaction.hash;
  change.blockNumber = event.block.number;
  change.timestamp = event.block.timestamp;
  change.save();

  const billing = new BillingEvent(eventId(event).concat('-tier'));
  billing.eventType = 'provider.tier_synced';
  billing.amount = event.params.subFeeBps;
  billing.actor = event.params.provider;
  billing.txHash = event.transaction.hash;
  billing.blockNumber = event.block.number;
  billing.timestamp = event.block.timestamp;
  billing.save();
}

export function handleProviderFeeRateSet(event: ProviderFeeRateSet): void {
  const change = new ProviderTierChange(eventId(event));
  change.provider = event.params.provider;
  change.tier = -1; // manual override, not tier-based
  change.subFeeBps = event.params.subFeeBps;
  change.settleFeeBps = event.params.settleFeeBps;
  change.txHash = event.transaction.hash;
  change.blockNumber = event.block.number;
  change.timestamp = event.block.timestamp;
  change.save();
}
