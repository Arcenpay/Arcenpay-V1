import { BigInt, Bytes } from '@graphprotocol/graph-ts';
import {
    SubscriptionMinted,
    SubscriptionRenewed,
    SubscriptionCancelled,
} from '../generated/SubscriptionRegistry/SubscriptionRegistry';
import { Subscription, ProtocolStats } from '../generated/schema';

function getOrCreateStats(): ProtocolStats {
    let stats = ProtocolStats.load('global');
    if (!stats) {
        stats = new ProtocolStats('global');
        stats.totalSubscriptions = 0;
        stats.activeSubscriptions = 0;
        stats.totalPlans = 0;
        stats.totalRevenue = BigInt.fromI32(0);
        stats.totalSettlements = 0;
        stats.totalSettlementVolume = BigInt.fromI32(0);
        stats.totalSessionsFunded = BigInt.fromI32(0);
    }
    return stats;
}

export function handleSubscriptionMinted(event: SubscriptionMinted): void {
    const id = event.params.tokenId.toString();
    let sub = new Subscription(id);

    sub.subscriber = event.params.subscriber;
    sub.plan = event.params.planId.toString();
    sub.expiration = event.params.expiration;
    sub.isActive = true;
    sub.mintedAt = event.block.timestamp;
    sub.amountPaid = BigInt.fromI32(0);
    sub.txHash = event.transaction.hash;
    sub.blockNumber = event.block.number;
    sub.save();

    // Update protocol stats
    const stats = getOrCreateStats();
    stats.totalSubscriptions += 1;
    stats.activeSubscriptions += 1;
    stats.save();
}

export function handleSubscriptionRenewed(event: SubscriptionRenewed): void {
    const id = event.params.tokenId.toString();
    let sub = Subscription.load(id);
    if (!sub) return;

    sub.expiration = event.params.newExpiration;
    sub.renewedAt = event.block.timestamp;
    sub.amountPaid = sub.amountPaid.plus(event.params.amountPaid);
    sub.isActive = true;
    sub.save();

    // Update protocol stats
    const stats = getOrCreateStats();
    stats.totalRevenue = stats.totalRevenue.plus(event.params.amountPaid);
    stats.save();
}

export function handleSubscriptionCancelled(event: SubscriptionCancelled): void {
    const id = event.params.tokenId.toString();
    let sub = Subscription.load(id);
    if (!sub) return;

    sub.isActive = false;
    sub.cancelledAt = event.block.timestamp;
    sub.save();

    const stats = getOrCreateStats();
    stats.activeSubscriptions -= 1;
    stats.save();
}
