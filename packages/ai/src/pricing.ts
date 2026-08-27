import { AIGatewayError } from './errors.js';
import type { AIModelRegistration } from './gateway-types.js';
import type { AIProviderUsage } from './types.js';

const SCALE = 100_000_000n;

function decimalUnits(value: string): bigint {
  const [whole, fraction = ''] = value.split('.');
  if (whole === undefined) throw new AIGatewayError('AI_GATEWAY_CONFIGURATION_INVALID');
  return BigInt(whole) * SCALE + BigInt(fraction.padEnd(8, '0'));
}

function formatUnits(value: bigint): string {
  const whole = value / SCALE;
  const fraction = (value % SCALE).toString().padStart(8, '0').replace(/0+$/, '');
  return fraction ? `${whole}.${fraction}` : whole.toString();
}

function tokenCost(tokens: number, rate: string): bigint {
  const numerator = decimalUnits(rate) * BigInt(tokens);
  return (numerator + 999n) / 1000n;
}

function normalizedPositiveCost(value: bigint): string {
  return formatUnits(value > 0n ? value : 1n);
}

export function countGatewayTokens(input: string): number {
  const normalized = input.trim();
  return normalized.length === 0 ? 0 : normalized.split(/\s+/u).length;
}

export function estimateGatewayCost(
  model: AIModelRegistration,
  inputTokens: number,
  maximumOutputTokens: number,
): string {
  const reservedInputTokens = inputTokens + model.inputTokenOverhead;
  if (
    !Number.isSafeInteger(inputTokens)
    || inputTokens < 0
    || !Number.isSafeInteger(maximumOutputTokens)
    || maximumOutputTokens < 0
    || !Number.isSafeInteger(model.inputTokenOverhead)
    || model.inputTokenOverhead < 0
    || !Number.isSafeInteger(reservedInputTokens)
  ) {
    throw new AIGatewayError('AI_GATEWAY_CONFIGURATION_INVALID');
  }
  return normalizedPositiveCost(
    tokenCost(reservedInputTokens, model.inputCostPerThousandTokens)
      + tokenCost(maximumOutputTokens, model.outputCostPerThousandTokens),
  );
}

export function actualGatewayCost(
  model: AIModelRegistration,
  usage: AIProviderUsage,
): string {
  return normalizedPositiveCost(
    tokenCost(usage.inputTokens, model.inputCostPerThousandTokens)
      + tokenCost(usage.outputTokens, model.outputCostPerThousandTokens),
  );
}
