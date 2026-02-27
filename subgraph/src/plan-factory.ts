import { BigInt, Bytes } from '@graphprotocol/graph-ts';
import {
  PlanCreated,
  PlanDeactivated,
  PlanFactory as PlanFactoryContract,
  PlanUpdated,
  ProviderRegistered,
} from '../generated/PlanFactory/PlanFactory';
import { Plan } from '../generated/schema';
import { getOrCreateProvider, getOrCreateStats } from './common';

const ZERO_ADDRESS = Bytes.fromHexString('0x0000000000000000000000000000000000000000') as Bytes;

function ensurePlan(planId: BigInt): Plan {
  let plan = Plan.load(planId.toString());
  if (!plan) {
    plan = new Plan(planId.toString());
    plan.provider = ZERO_ADDRESS;
    plan.name = 'Unknown';
    plan.tier = 'Unknown';
    plan.price = BigInt.fromI32(0);
    plan.billingInterval = BigInt.fromI32(0);
    plan.acceptedToken = ZERO_ADDRESS;
    plan.active = true;
    plan.createdAt = BigInt.fromI32(0);
    plan.subscriberCount = 0;
  }
  return plan;
}

function hydratePlanFromContract(contract: PlanFactoryContract, plan: Plan, planId: BigInt): void {
  const maybePlan = contract.try_getPlan(planId);
  if (maybePlan.reverted) {
    return;
  }

  const value = maybePlan.value;
  plan.provider = value.provider;
  plan.name = value.name;
  plan.tier = value.tier;
  plan.price = value.price;
  plan.billingInterval = value.billingInterval;
  plan.acceptedToken = value.acceptedToken;
  plan.active = value.active;
}

export function handleProviderRegistered(event: ProviderRegistered): void {
  const provider = getOrCreateProvider(event.params.provider, event.block.timestamp);
  provider.save();
}

export function handlePlanCreated(event: PlanCreated): void {
  const contract = PlanFactoryContract.bind(event.address);
  const plan = ensurePlan(event.params.planId);

  plan.provider = event.params.provider;
  plan.name = event.params.name;
  plan.price = event.params.price;
  plan.billingInterval = event.params.billingInterval;
  plan.active = true;
  plan.createdAt = event.block.timestamp;

  hydratePlanFromContract(contract, plan, event.params.planId);
  plan.save();

  const provider = getOrCreateProvider(event.params.provider, event.block.timestamp);
  provider.planCount += 1;
  provider.save();

  const stats = getOrCreateStats();
  stats.totalPlans += 1;
  stats.save();
}

export function handlePlanUpdated(event: PlanUpdated): void {
  const contract = PlanFactoryContract.bind(event.address);
  const plan = ensurePlan(event.params.planId);

  hydratePlanFromContract(contract, plan, event.params.planId);
  plan.save();
}

export function handlePlanDeactivated(event: PlanDeactivated): void {
  const plan = ensurePlan(event.params.planId);
  plan.active = false;
  plan.save();
}
