import { BigInt } from '@graphprotocol/graph-ts';
import {
  SessionFunded,
  SessionSettled,
  SessionVault as SessionVaultContract,
  SessionWithdrawn,
} from '../generated/SessionVault/SessionVault';
import { BillingEvent, FundEvent } from '../generated/schema';
import { eventId, getOrCreateSession, getOrCreateStats } from './common';

export function handleSessionFunded(event: SessionFunded): void {
  const session = getOrCreateSession(event.params.sessionId, event.params.agent);
  session.totalFunded = session.totalFunded.plus(event.params.amount);
  session.currentBalance = session.currentBalance.plus(event.params.amount);
  session.agent = event.params.agent;
  session.save();

  const fund = new FundEvent(eventId(event));
  fund.session = session.id;
  fund.amount = event.params.amount;
  fund.txHash = event.transaction.hash;
  fund.blockNumber = event.block.number;
  fund.timestamp = event.block.timestamp;
  fund.eventType = 'funded';
  fund.save();

  const stats = getOrCreateStats();
  stats.totalSessionsFunded = stats.totalSessionsFunded.plus(event.params.amount);
  stats.save();

  const billing = new BillingEvent(eventId(event));
  billing.eventType = 'session.funded';
  billing.sessionId = event.params.sessionId;
  billing.amount = event.params.amount;
  billing.actor = event.params.agent;
  billing.txHash = event.transaction.hash;
  billing.blockNumber = event.block.number;
  billing.timestamp = event.block.timestamp;
  billing.save();
}

export function handleSessionWithdrawn(event: SessionWithdrawn): void {
  const session = getOrCreateSession(event.params.sessionId, event.params.agent);
  session.totalWithdrawn = session.totalWithdrawn.plus(event.params.amount);
  if (session.currentBalance >= event.params.amount) {
    session.currentBalance = session.currentBalance.minus(event.params.amount);
  } else {
    session.currentBalance = BigInt.fromI32(0);
  }
  session.save();

  const fund = new FundEvent(eventId(event));
  fund.session = session.id;
  fund.amount = event.params.amount;
  fund.txHash = event.transaction.hash;
  fund.blockNumber = event.block.number;
  fund.timestamp = event.block.timestamp;
  fund.eventType = 'withdrawn';
  fund.save();

  const billing = new BillingEvent(eventId(event));
  billing.eventType = 'session.withdrawn';
  billing.sessionId = event.params.sessionId;
  billing.amount = event.params.amount;
  billing.actor = event.params.agent;
  billing.txHash = event.transaction.hash;
  billing.blockNumber = event.block.number;
  billing.timestamp = event.block.timestamp;
  billing.save();
}

export function handleSessionSettled(event: SessionSettled): void {
  const contract = SessionVaultContract.bind(event.address);
  const maybeSession = contract.try_getSession(event.params.sessionId);
  const agent = maybeSession.reverted
    ? event.params.provider
    : maybeSession.value.agent;

  const session = getOrCreateSession(event.params.sessionId, agent);
  session.totalSettled = session.totalSettled.plus(event.params.amount);
  if (session.currentBalance >= event.params.amount) {
    session.currentBalance = session.currentBalance.minus(event.params.amount);
  } else {
    session.currentBalance = BigInt.fromI32(0);
  }
  session.save();

  const billing = new BillingEvent(eventId(event));
  billing.eventType = 'session.settled';
  billing.sessionId = event.params.sessionId;
  billing.amount = event.params.amount;
  billing.actor = event.params.provider;
  billing.txHash = event.transaction.hash;
  billing.blockNumber = event.block.number;
  billing.timestamp = event.block.timestamp;
  billing.save();
}
