import { BigInt } from '@graphprotocol/graph-ts';
import {
  SubscriptionMinted,
  SubscriptionRenewed,
  SubscriptionCancelled,
} from '../generated/SubscriptionRegistry/SubscriptionRegistry';
import { BillingEvent, Plan, SubscriptionRecord } from '../generated/schema';
import { eventId, getOrCreateStats, getOrCreateSubscriber } from './common';

export function handleSubscriptionMinted(event: SubscriptionMinted): void {
  const id = event.params.tokenId.toString();
  let sub = new SubscriptionRecord(id);

  let plan = Plan.load(event.params.planId.toString());
  if (!plan) {
    plan = new Plan(event.params.planId.toString());
    plan.provider = event.transaction.from;
    plan.name = 'Unknown';
    plan.tier = 'Unknown';
    plan.price = BigInt.fromI32(0);
    plan.billingInterval = BigInt.fromI32(0);
    plan.active = true;
    plan.createdAt = event.block.timestamp;
    plan.subscriberCount = 0;
    plan.save();
  }

  sub.subscriber = event.params.subscriber;
  sub.plan = event.params.planId.toString();
  sub.expiration = event.params.expiration;
  sub.isActive = true;
  sub.mintedAt = event.block.timestamp;
  sub.amountPaid = BigInt.fromI32(0);
  sub.txHash = event.transaction.hash;
  sub.blockNumber = event.block.number;
  sub.save();

  plan.subscriberCount += 1;
  plan.save();

  const subscriber = getOrCreateSubscriber(event.params.subscriber, event.block.timestamp);
  subscriber.activeSubscriptionCount += 1;
  subscriber.save();

  const stats = getOrCreateStats();
  stats.totalSubscriptions += 1;
  stats.activeSubscriptions += 1;
  stats.save();

  const billing = new BillingEvent(eventId(event));
  billing.eventType = 'subscription.minted';
  billing.tokenId = event.params.tokenId;
  billing.planId = event.params.planId;
  billing.amount = BigInt.fromI32(0);
  billing.actor = event.params.subscriber;
  billing.txHash = event.transaction.hash;
  billing.blockNumber = event.block.number;
  billing.timestamp = event.block.timestamp;
  billing.save();
}

export function handleSubscriptionRenewed(event: SubscriptionRenewed): void {
  const id = event.params.tokenId.toString();
  let sub = SubscriptionRecord.load(id);
  if (!sub) return;

  sub.expiration = event.params.newExpiration;
  sub.renewedAt = event.block.timestamp;
  sub.amountPaid = sub.amountPaid.plus(event.params.amountPaid);
  sub.isActive = true;
  sub.save();

  const subscriber = getOrCreateSubscriber(sub.subscriber, event.block.timestamp);
  subscriber.totalPaid = subscriber.totalPaid.plus(event.params.amountPaid);
  subscriber.save();

  const stats = getOrCreateStats();
  stats.totalRevenue = stats.totalRevenue.plus(event.params.amountPaid);
  stats.save();

  const billing = new BillingEvent(eventId(event));
  billing.eventType = 'subscription.renewed';
  billing.tokenId = event.params.tokenId;
  billing.amount = event.params.amountPaid;
  billing.actor = sub.subscriber;
  billing.txHash = event.transaction.hash;
  billing.blockNumber = event.block.number;
  billing.timestamp = event.block.timestamp;
  billing.save();
}

export function handleSubscriptionCancelled(event: SubscriptionCancelled): void {
  const id = event.params.tokenId.toString();
  let sub = SubscriptionRecord.load(id);
  if (!sub) return;

  sub.isActive = false;
  sub.cancelledAt = event.block.timestamp;
  sub.save();

  const subscriber = getOrCreateSubscriber(sub.subscriber, event.block.timestamp);
  if (subscriber.activeSubscriptionCount > 0) {
    subscriber.activeSubscriptionCount -= 1;
  }
  subscriber.save();

  const plan = Plan.load(sub.plan);
  if (plan && plan.subscriberCount > 0) {
    plan.subscriberCount -= 1;
    plan.save();
  }

  const stats = getOrCreateStats();
  if (stats.activeSubscriptions > 0) {
    stats.activeSubscriptions -= 1;
  }
  stats.save();

  const billing = new BillingEvent(eventId(event));
  billing.eventType = 'subscription.cancelled';
  billing.tokenId = event.params.tokenId;
  billing.actor = sub.subscriber;
  billing.txHash = event.transaction.hash;
  billing.blockNumber = event.block.number;
  billing.timestamp = event.block.timestamp;
  billing.save();
}
