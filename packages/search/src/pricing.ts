import { SearchGatewayError } from './errors.js';
import type { SearchProviderRegistration } from './types.js';

const SCALE = 100_000_000n;
const DECIMAL = /^(?:0|[1-9][0-9]{0,15})(?:\.[0-9]{1,8})?$/;
const MAX_RESULTS = 50;
const MAX_PROVIDER_REQUESTS = 3;

function decimalUnits(value: string): bigint {
  if (!DECIMAL.test(value)) {
    throw new SearchGatewayError('SEARCH_GATEWAY_CONFIGURATION_INVALID');
  }
  const [whole, fraction = ''] = value.split('.');
  if (whole === undefined) {
    throw new SearchGatewayError('SEARCH_GATEWAY_CONFIGURATION_INVALID');
  }
  return BigInt(whole) * SCALE + BigInt(fraction.padEnd(8, '0'));
}

function formatUnits(value: bigint): string {
  const whole = value / SCALE;
  const fraction = (value % SCALE).toString().padStart(8, '0').replace(/0+$/, '');
  return fraction ? `${whole}.${fraction}` : whole.toString();
}

function validateResultCount(value: number): void {
  if (!Number.isSafeInteger(value) || value < 0 || value > MAX_RESULTS) {
    throw new SearchGatewayError('SEARCH_GATEWAY_CONFIGURATION_INVALID');
  }
}

function validateRequestCount(value: number): void {
  if (!Number.isSafeInteger(value) || value < 1 || value > MAX_PROVIDER_REQUESTS) {
    throw new SearchGatewayError('SEARCH_GATEWAY_CONFIGURATION_INVALID');
  }
}

function costForResults(
  registration: SearchProviderRegistration,
  resultCount: number,
  requestCount: number,
): string {
  validateResultCount(resultCount);
  validateRequestCount(requestCount);
  const requestCost = decimalUnits(registration.requestCost);
  const resultCost = decimalUnits(registration.resultCost);
  if (requestCost <= 0n) {
    throw new SearchGatewayError('SEARCH_GATEWAY_CONFIGURATION_INVALID');
  }
  const amount = requestCost * BigInt(requestCount) + resultCost * BigInt(resultCount);
  if (amount <= 0n) {
    throw new SearchGatewayError('SEARCH_GATEWAY_CONFIGURATION_INVALID');
  }
  return formatUnits(amount);
}

export function estimateSearchCost(
  registration: SearchProviderRegistration,
  maximumResults: number,
  maximumProviderRequests = 1,
): string {
  return costForResults(registration, maximumResults, maximumProviderRequests);
}

export function actualSearchCost(
  registration: SearchProviderRegistration,
  actualResults: number,
  providerRequestCount = 1,
): string {
  return costForResults(registration, actualResults, providerRequestCount);
}
