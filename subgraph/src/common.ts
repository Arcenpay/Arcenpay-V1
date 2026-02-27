import { BigInt, Bytes, ethereum } from '@graphprotocol/graph-ts';
import { ProtocolStats, Session, Subscriber, Provider } from '../generated/schema';

export function getOrCreateStats(): ProtocolStats {
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

export function getOrCreateSession(sessionId: Bytes, agent: Bytes): Session {
  const id = sessionId.toHexString();
  let session = Session.load(id);
  if (!session) {
    session = new Session(id);
    session.agent = agent;
    session.totalFunded = BigInt.fromI32(0);
    session.totalWithdrawn = BigInt.fromI32(0);
    session.totalSettled = BigInt.fromI32(0);
    session.currentBalance = BigInt.fromI32(0);
  }
  return session;
}

export function getOrCreateSubscriber(wallet: Bytes, timestamp: BigInt): Subscriber {
  const id = wallet.toHexString();
  let subscriber = Subscriber.load(id);
  if (!subscriber) {
    subscriber = new Subscriber(id);
    subscriber.wallet = wallet;
    subscriber.activeSubscriptionCount = 0;
    subscriber.totalPaid = BigInt.fromI32(0);
  }
  subscriber.lastUpdated = timestamp;
  return subscriber;
}

export function getOrCreateProvider(wallet: Bytes, timestamp: BigInt): Provider {
  const id = wallet.toHexString();
  let provider = Provider.load(id);
  if (!provider) {
    provider = new Provider(id);
    provider.wallet = wallet;
    provider.createdAt = timestamp;
    provider.planCount = 0;
    provider.totalRevenue = BigInt.fromI32(0);
  }
  return provider;
}

export function eventId(event: ethereum.Event): string {
  return event.transaction.hash.toHexString() + '-' + event.logIndex.toString();
}
