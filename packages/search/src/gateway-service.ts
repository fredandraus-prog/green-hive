import { createHash } from 'node:crypto';
import type { TrustedAppContext } from '@green-hive/core';
import { SearchGatewayError, SearchProviderError } from './errors.js';
import { validateSearchExecuteInput, validateTrustedSearchGatewayContext } from './gateway-validation.js';
import { actualSearchCost, estimateSearchCost } from './pricing.js';
import { SearchGatewayRegistry } from './registry.js';
import {
  SEARCH_CONTENT_TRUST,
  type SearchExecuteInput,
  type SearchGatewayConfiguration,
  type SearchGatewayDependencies,
  type SearchGatewayResult,
  type SearchProvider,
  type SearchProviderRegistration,
  type SearchProviderResult,
  type SearchTaskRegistration,
  type ValidatedSearchExecuteInput,
} from './types.js';
import { validateSearchProviderResult } from './validation.js';

function sha256(value: string): string {
  return createHash('sha256').update(value, 'utf8').digest('hex');
}

function requestFingerprint(
  input: ValidatedSearchExecuteInput,
  task: SearchTaskRegistration,
  registration: SearchProviderRegistration,
): string {
  return sha256(JSON.stringify({
    projectId: input.projectId,
    budgetId: input.budgetId,
    operationId: input.operationId,
    searchType: input.searchType,
    classification: input.classification,
    confidentialMode: input.confidentialMode,
    querySha256: sha256(input.query),
    providerCode: registration.providerCode,
    providerClass: registration.providerClass,
    maxResults: task.maxResults,
    maxAttempts: task.retryPolicy.maxAttempts,
    retryableProviderErrors: task.retryPolicy.retryableProviderErrors,
    cachePolicy: task.cachePolicy,
    requestCost: registration.requestCost,
    resultCost: registration.resultCost,
    currency: registration.currency,
  }));
}

function retryableCode(error: unknown): 'UNAVAILABLE' | 'TIMEOUT' | null {
  if (!(error instanceof SearchProviderError)) return null;
  if (error.code === 'SEARCH_PROVIDER_UNAVAILABLE') return 'UNAVAILABLE';
  if (error.code === 'SEARCH_PROVIDER_TIMEOUT') return 'TIMEOUT';
  return null;
}

function publicGatewayError(error: unknown): SearchGatewayError {
  if (error instanceof SearchGatewayError) return error;
  if (error instanceof SearchProviderError) {
    if (error.code === 'SEARCH_PROVIDER_UNAVAILABLE') {
      return new SearchGatewayError('SEARCH_GATEWAY_PROVIDER_UNAVAILABLE');
    }
    if (error.code === 'SEARCH_PROVIDER_TIMEOUT') {
      return new SearchGatewayError('SEARCH_GATEWAY_PROVIDER_TIMEOUT');
    }
    return new SearchGatewayError('SEARCH_GATEWAY_PROVIDER_FAILED');
  }
  return new SearchGatewayError('SEARCH_GATEWAY_OPERATION_FAILED');
}

export class SearchGatewayService {
  readonly #registry: SearchGatewayRegistry;
  readonly #dependencies: SearchGatewayDependencies;

  constructor(configuration: SearchGatewayConfiguration, dependencies: SearchGatewayDependencies) {
    if (
      !dependencies?.trustPolicy
      || !dependencies.costGuard
      || !dependencies.operations
    ) {
      throw new SearchGatewayError('SEARCH_GATEWAY_CONFIGURATION_INVALID');
    }
    this.#registry = new SearchGatewayRegistry(configuration);
    this.#dependencies = dependencies;
  }

  async execute(
    context: TrustedAppContext,
    executeInput: SearchExecuteInput,
  ): Promise<SearchGatewayResult> {
    const trustedContext = validateTrustedSearchGatewayContext(context);
    const input = validateSearchExecuteInput(executeInput);
    if (!input.searchType.startsWith(`${trustedContext.appCode}_`)) {
      throw new SearchGatewayError('SEARCH_GATEWAY_ACCESS_DENIED');
    }

    const task = this.#registry.task(input.searchType);
    if (!this.#registry.acceptsClassification(task, input.classification)) {
      throw new SearchGatewayError('SEARCH_GATEWAY_TRUST_DENIED');
    }
    const { registration, provider } = this.#registry.route(task);
    const trust = this.#dependencies.trustPolicy.evaluate(trustedContext, {
      projectId: input.projectId,
      operation: 'SEARCH_QUERY',
      classification: input.classification,
      providerCode: registration.providerCode,
      confidentialMode: input.confidentialMode,
    });
    if (trust.decision === 'DENY') {
      throw new SearchGatewayError('SEARCH_GATEWAY_TRUST_DENIED');
    }
    if (trust.decision === 'REQUIRE_CONFIRMATION') {
      throw new SearchGatewayError('SEARCH_GATEWAY_CONFIRMATION_REQUIRED');
    }

    let providerQuery = input.query;
    if (trust.decision === 'ALLOW_WITH_SANITIZATION') {
      if (!task.sanitizer || task.sanitizer.mode !== trust.sanitizationMode) {
        throw new SearchGatewayError('SEARCH_GATEWAY_SANITIZER_REQUIRED');
      }
      let sanitizedQuery: unknown;
      try {
        sanitizedQuery = task.sanitizer.sanitize(input.query);
      } catch {
        throw new SearchGatewayError('SEARCH_GATEWAY_SANITIZER_REQUIRED');
      }
      if (
        typeof sanitizedQuery !== 'string'
        || !sanitizedQuery.trim()
        || sanitizedQuery.length > task.maxQueryCharacters
      ) {
        throw new SearchGatewayError('SEARCH_GATEWAY_SANITIZER_REQUIRED');
      }
      providerQuery = sanitizedQuery;
    } else if (providerQuery.length > task.maxQueryCharacters) {
      throw new SearchGatewayError('SEARCH_GATEWAY_INVALID_INPUT');
    }

    const estimatedAmount = estimateSearchCost(
      registration,
      task.maxResults,
      task.retryPolicy.maxAttempts,
    );
    const fingerprint = requestFingerprint(input, task, registration);
    const cacheStatus = 'NOT_APPLICABLE' as const;
    let operationStarted = false;
    let reservationId: string | null = null;

    try {
      await this.#dependencies.operations.start(trustedContext, {
        projectId: input.projectId,
        operationId: input.operationId,
        searchType: task.searchType,
        capabilityCode: task.capabilityCode,
        classification: input.classification,
        providerCode: registration.providerCode,
        trustPolicyCode: trust.policyCode,
        trustDecision: trust.decision,
        sanitizationMode: trust.sanitizationMode,
        maxResults: task.maxResults,
        cacheStatus,
        requestFingerprint: fingerprint,
        estimatedCost: estimatedAmount,
        currency: registration.currency,
      });
      operationStarted = true;

      const cost = await this.#dependencies.costGuard.reserve(trustedContext, {
        projectId: input.projectId,
        budgetId: input.budgetId,
        operationId: input.operationId,
        capabilityCode: task.capabilityCode,
        estimatedAmount,
        currency: registration.currency,
        metadata: {
          serviceCode: 'SEARCH_GATEWAY',
          searchType: task.searchType,
          providerClass: registration.providerClass,
        },
      });
      if (!cost.decision.outcome.startsWith('ALLOW') || !cost.reservation) {
        throw new SearchGatewayError('SEARCH_GATEWAY_COST_DENIED');
      }
      reservationId = cost.reservation.id;

      const { providerResult, providerRequestCount } = await this.#callProvider(
        provider,
        task,
        registration,
        input.operationId,
        providerQuery,
      );
      const actualAmount = actualSearchCost(
        registration,
        providerResult.results.length,
        providerRequestCount,
      );
      await this.#dependencies.operations.complete(trustedContext, {
        operationId: input.operationId,
        reservationId,
        resultCount: providerResult.results.length,
        requestCount: providerRequestCount,
        actualCost: actualAmount,
        cacheStatus,
      });
      return this.#buildResult(
        input.operationId,
        task,
        registration,
        providerResult,
        providerRequestCount,
        trust,
        reservationId,
        estimatedAmount,
        actualAmount,
        cacheStatus,
      );
    } catch (error) {
      const publicError = publicGatewayError(error);
      if (operationStarted) {
        await this.#dependencies.operations.fail(trustedContext, {
          operationId: input.operationId,
          reservationId,
          errorCode: publicError.code,
        }).catch(() => undefined);
      }
      throw publicError;
    }
  }

  async #callProvider(
    provider: SearchProvider,
    task: SearchTaskRegistration,
    registration: SearchProviderRegistration,
    operationId: string,
    query: string,
  ): Promise<{
    readonly providerResult: SearchProviderResult;
    readonly providerRequestCount: number;
  }> {
    let lastError: unknown = new SearchProviderError('SEARCH_PROVIDER_FAILED');
    for (let attempt = 1; attempt <= task.retryPolicy.maxAttempts; attempt += 1) {
      try {
        const raw = await provider.search({
          operationId,
          query,
          maxResults: task.maxResults,
        });
        const validated = validateSearchProviderResult(raw, task.maxResults);
        if (
          validated.providerCode !== registration.providerCode
          || validated.contentTrust !== SEARCH_CONTENT_TRUST
          || validated.usage.requestCount !== 1
          || validated.usage.resultCount !== validated.results.length
        ) {
          throw new SearchProviderError('SEARCH_PROVIDER_INVALID_OUTPUT');
        }
        return Object.freeze({ providerResult: validated, providerRequestCount: attempt });
      } catch (error) {
        lastError = error;
        const retryable = retryableCode(error);
        if (
          !retryable
          || !task.retryPolicy.retryableProviderErrors.includes(retryable)
          || attempt === task.retryPolicy.maxAttempts
        ) break;
      }
    }
    throw lastError;
  }

  #buildResult(
    operationId: string,
    task: SearchTaskRegistration,
    registration: SearchProviderRegistration,
    providerResult: SearchProviderResult,
    providerRequestCount: number,
    trust: ReturnType<SearchGatewayDependencies['trustPolicy']['evaluate']>,
    reservationId: string,
    estimatedAmount: string,
    actualAmount: string,
    cacheStatus: 'NOT_APPLICABLE',
  ): SearchGatewayResult {
    return Object.freeze({
      operationId,
      searchType: task.searchType,
      providerCode: registration.providerCode,
      contentTrust: SEARCH_CONTENT_TRUST,
      cacheStatus,
      results: Object.freeze(providerResult.results.map((result) => Object.freeze({ ...result }))),
      usage: Object.freeze({
        requestCount: providerRequestCount,
        resultCount: providerResult.results.length,
      }),
      trust: Object.freeze({
        configurationRelease: trust.configurationRelease,
        policyCode: trust.policyCode,
        decision: trust.decision,
        sanitizationMode: trust.sanitizationMode,
      }),
      cost: Object.freeze({
        reservationId,
        estimatedAmount,
        actualAmount,
        currency: registration.currency,
      }),
    });
  }
}
