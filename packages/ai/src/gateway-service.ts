import { createHash } from 'node:crypto';
import type { TrustedAppContext } from '@green-hive/core';
import { AIProviderError } from './errors.js';
import { AIGatewayError } from './errors.js';
import type {
  AIGatewayConfiguration,
  AIGatewayDependencies,
  AIGatewayResult,
  AIExecuteInput,
  AIModelRegistration,
  AITaskRegistration,
  ValidatedAIExecuteInput,
} from './gateway-types.js';
import { validateAIExecuteInput, validateTrustedAIGatewayContext } from './gateway-validation.js';
import { actualGatewayCost, countGatewayTokens, estimateGatewayCost } from './pricing.js';
import { AIGatewayRegistry } from './registry.js';
import type {
  AIStructuredGenerationResult,
  AITextGenerationResult,
} from './types.js';
import {
  validateAIStructuredGenerationResult,
  validateAIJsonValue,
  validateAITextGenerationResult,
} from './validation.js';

function sha256(value: string): string {
  return createHash('sha256').update(value, 'utf8').digest('hex');
}

function requestFingerprint(
  input: ValidatedAIExecuteInput,
  task: AITaskRegistration,
  model: AIModelRegistration,
): string {
  return sha256(JSON.stringify({
    projectId: input.projectId,
    budgetId: input.budgetId,
    operationId: input.operationId,
    taskType: input.taskType,
    classification: input.classification,
    confidentialMode: input.confidentialMode,
    inputSha256: sha256(input.input),
    outputMode: task.outputMode,
    outputSchemaId: task.outputSchemaId ?? null,
    providerCode: model.providerCode,
    modelCode: model.modelCode,
  }));
}

function retryableCode(error: unknown): 'UNAVAILABLE' | 'TIMEOUT' | null {
  if (!(error instanceof AIProviderError)) return null;
  if (error.code === 'AI_PROVIDER_UNAVAILABLE') return 'UNAVAILABLE';
  if (error.code === 'AI_PROVIDER_TIMEOUT') return 'TIMEOUT';
  return null;
}

function gatewayProviderError(error: unknown): AIGatewayError {
  if (error instanceof AIGatewayError) return error;
  if (error instanceof AIProviderError) {
    if (error.code === 'AI_PROVIDER_UNAVAILABLE') {
      return new AIGatewayError('AI_GATEWAY_PROVIDER_UNAVAILABLE');
    }
    if (error.code === 'AI_PROVIDER_TIMEOUT') {
      return new AIGatewayError('AI_GATEWAY_PROVIDER_TIMEOUT');
    }
    return new AIGatewayError('AI_GATEWAY_PROVIDER_FAILED');
  }
  return new AIGatewayError('AI_GATEWAY_OPERATION_FAILED');
}

function validateStructuredIdentity(
  value: unknown,
  operationId: string,
  taskType: string,
  schemaId: string,
): void {
  if (typeof value !== 'object' || value === null || Array.isArray(value)) return;
  const record = value as Record<string, unknown>;
  const expected: Readonly<Record<string, string>> = {
    operationId,
    taskType,
    schemaId,
  };
  for (const [key, expectedValue] of Object.entries(expected)) {
    if (Object.prototype.hasOwnProperty.call(record, key) && record[key] !== expectedValue) {
      throw new AIGatewayError('AI_GATEWAY_OUTPUT_SCHEMA_INVALID');
    }
  }
}

export class AIGatewayService {
  readonly #registry: AIGatewayRegistry;
  readonly #dependencies: AIGatewayDependencies;

  constructor(configuration: AIGatewayConfiguration, dependencies: AIGatewayDependencies) {
    if (!dependencies?.trustPolicy || !dependencies.costGuard || !dependencies.usageCost || !dependencies.operations) {
      throw new AIGatewayError('AI_GATEWAY_CONFIGURATION_INVALID');
    }
    this.#registry = new AIGatewayRegistry(configuration);
    this.#dependencies = dependencies;
  }

  async execute(context: TrustedAppContext, executeInput: AIExecuteInput): Promise<AIGatewayResult> {
    const trustedContext = validateTrustedAIGatewayContext(context);
    const input = validateAIExecuteInput(executeInput);
    if (!input.taskType.startsWith(`${trustedContext.appCode}_`)) {
      throw new AIGatewayError('AI_GATEWAY_ACCESS_DENIED');
    }
    const task = this.#registry.task(input.taskType);
    if (!this.#registry.acceptsClassification(task, input.classification)) {
      throw new AIGatewayError('AI_GATEWAY_TRUST_DENIED');
    }
    const { model, provider } = this.#registry.route(task);
    const trust = this.#dependencies.trustPolicy.evaluate(trustedContext, {
      projectId: input.projectId,
      operation: 'EXTERNAL_PROVIDER',
      classification: input.classification,
      providerCode: model.providerCode,
      confidentialMode: input.confidentialMode,
    });
    if (trust.decision === 'DENY') throw new AIGatewayError('AI_GATEWAY_TRUST_DENIED');
    if (trust.decision === 'REQUIRE_CONFIRMATION') {
      throw new AIGatewayError('AI_GATEWAY_CONFIRMATION_REQUIRED');
    }
    let providerInput = input.input;
    if (trust.decision === 'ALLOW_WITH_SANITIZATION') {
      if (!task.sanitizer || task.sanitizer.mode !== trust.sanitizationMode) {
        throw new AIGatewayError('AI_GATEWAY_SANITIZER_REQUIRED');
      }
      try {
        providerInput = task.sanitizer.sanitize(input.input);
      } catch {
        throw new AIGatewayError('AI_GATEWAY_SANITIZER_REQUIRED');
      }
      if (!providerInput.trim() || providerInput.length > 65_536) {
        throw new AIGatewayError('AI_GATEWAY_SANITIZER_REQUIRED');
      }
    }
    const inputTokens = countGatewayTokens(providerInput);
    if (inputTokens < 1 || inputTokens > task.maxInputTokensInternal) {
      throw new AIGatewayError('AI_GATEWAY_INVALID_INPUT');
    }
    const estimatedAmount = estimateGatewayCost(model, inputTokens, task.maxOutputTokensInternal);
    const fingerprint = requestFingerprint(input, task, model);
    let operationStarted = false;
    let reservationId: string | null = null;
    try {
      await this.#dependencies.operations.start(trustedContext, {
        projectId: input.projectId,
        operationId: input.operationId,
        taskType: task.taskType,
        outputMode: task.outputMode,
        outputSchemaId: task.outputSchemaId ?? null,
        classification: input.classification,
        providerCode: model.providerCode,
        modelCode: model.modelCode,
        trustPolicyCode: trust.policyCode,
        trustDecision: trust.decision,
        sanitizationMode: trust.sanitizationMode,
        estimatedCost: estimatedAmount,
        currency: model.currency,
        requestFingerprint: fingerprint,
      });
      operationStarted = true;
      const cost = await this.#dependencies.costGuard.reserve(trustedContext, {
        projectId: input.projectId,
        budgetId: input.budgetId,
        operationId: input.operationId,
        capabilityCode: task.capabilityCode,
        estimatedAmount,
        currency: model.currency,
        metadata: {
          serviceCode: 'AI_GATEWAY',
          taskType: task.taskType,
          modelClass: model.modelClass,
        },
      });
      if (!cost.decision.outcome.startsWith('ALLOW') || !cost.reservation) {
        throw new AIGatewayError('AI_GATEWAY_COST_DENIED');
      }
      reservationId = cost.reservation.id;
      const providerResult = await this.#callProvider(provider, task, model, input.operationId, providerInput);
      const actualAmount = actualGatewayCost(model, providerResult.usage);
      await this.#dependencies.costGuard.consume(trustedContext, {
        reservationId,
        actualAmount,
        providerCode: model.providerCode,
        serviceCode: 'AI_GATEWAY',
        modelCode: model.modelCode,
        metadata: {
          taskType: task.taskType,
          outputMode: task.outputMode,
        },
      });
      await this.#dependencies.usageCost.recordUsage(trustedContext, {
        projectId: input.projectId,
        operationId: input.operationId,
        idempotencyKey: `ai-usage:${sha256(input.operationId).slice(0, 48)}`,
        eventKind: 'DEBIT',
        usageCode: 'AI_TOKENS',
        quantity: String(providerResult.usage.inputTokens + providerResult.usage.outputTokens),
        unitCode: 'TOKENS',
        capabilityCode: task.capabilityCode,
        providerCode: model.providerCode,
        serviceCode: 'AI_GATEWAY',
        metadata: {
          taskType: task.taskType,
          outputMode: task.outputMode,
          inputTokens: providerResult.usage.inputTokens,
          outputTokens: providerResult.usage.outputTokens,
        },
      });
      const result = this.#validateAndBuildResult(
        task,
        input.operationId,
        model,
        providerResult,
        trust,
        reservationId,
        estimatedAmount,
        actualAmount,
      );
      await this.#dependencies.operations.complete(trustedContext, {
        operationId: input.operationId,
        finishReason: providerResult.finishReason,
        inputTokens: providerResult.usage.inputTokens,
        outputTokens: providerResult.usage.outputTokens,
        actualCost: actualAmount,
      });
      return result;
    } catch (error) {
      const publicError = gatewayProviderError(error);
      if (operationStarted) {
        await this.#dependencies.operations.fail(trustedContext, {
          operationId: input.operationId,
          errorCode: publicError.code,
        }).catch(() => undefined);
      }
      if (reservationId) {
        await this.#dependencies.costGuard.release(trustedContext, {
          reservationId,
          metadata: { reasonCode: publicError.code },
        }).catch(() => undefined);
      }
      throw publicError;
    }
  }

  async #callProvider(
    provider: AIGatewayConfiguration['providers'][number],
    task: AITaskRegistration,
    model: AIModelRegistration,
    operationId: string,
    input: string,
  ): Promise<AITextGenerationResult | AIStructuredGenerationResult> {
    let lastError: unknown;
    for (let attempt = 1; attempt <= task.retryPolicy.maxAttempts; attempt += 1) {
      try {
        const common = {
          operationId,
          taskType: task.taskType,
          modelClass: model.modelClass,
          input,
          maxOutputTokens: task.maxOutputTokensInternal,
        };
        const raw = task.outputMode === 'TEXT'
          ? await provider.generateText(common)
          : await provider.generateStructured({ ...common, outputSchemaId: task.outputSchemaId! });
        const validated = task.outputMode === 'TEXT'
          ? validateAITextGenerationResult(raw)
          : validateAIStructuredGenerationResult(raw);
        if (
          validated.providerCode !== model.providerCode
          || validated.modelCode !== model.modelCode
          || validated.usage.inputTokens > model.maxInputTokens
          || validated.usage.outputTokens > task.maxOutputTokensInternal
        ) throw new AIProviderError('AI_PROVIDER_INVALID_OUTPUT');
        return validated;
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

  #validateAndBuildResult(
    task: AITaskRegistration,
    operationId: string,
    model: AIModelRegistration,
    providerResult: AITextGenerationResult | AIStructuredGenerationResult,
    trust: ReturnType<AIGatewayDependencies['trustPolicy']['evaluate']>,
    reservationId: string,
    estimatedAmount: string,
    actualAmount: string,
  ): AIGatewayResult {
    const base = {
      operationId,
      taskType: task.taskType,
      providerCode: model.providerCode,
      modelCode: model.modelCode,
      finishReason: providerResult.finishReason,
      usage: Object.freeze({ ...providerResult.usage }),
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
        currency: model.currency,
      }),
    };
    if (task.outputMode === 'TEXT' && providerResult.outputMode === 'TEXT') {
      return Object.freeze({ outputMode: 'TEXT', ...base, content: providerResult.content });
    }
    if (task.outputMode === 'STRUCTURED' && providerResult.outputMode === 'STRUCTURED' && task.outputSchemaId) {
      try {
        validateStructuredIdentity(
          providerResult.value,
          operationId,
          task.taskType,
          task.outputSchemaId,
        );
        const schema = this.#registry.schema(task.outputSchemaId);
        const value = validateAIJsonValue(schema.validate(validateAIJsonValue(providerResult.value)));
        validateStructuredIdentity(value, operationId, task.taskType, task.outputSchemaId);
        return Object.freeze({
          outputMode: 'STRUCTURED',
          ...base,
          outputSchemaId: task.outputSchemaId,
          value,
        });
      } catch {
        throw new AIGatewayError('AI_GATEWAY_OUTPUT_SCHEMA_INVALID');
      }
    }
    throw new AIGatewayError('AI_GATEWAY_OUTPUT_SCHEMA_INVALID');
  }
}
