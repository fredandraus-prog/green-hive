import type { TrustedAppContext, TrustedOrganizationContext } from '@green-hive/core';
import { DATA_CLASSIFICATIONS, type DataClassification } from '@green-hive/trust';
import { AIGatewayError } from './errors.js';
import type { AIExecuteInput, ValidatedAIExecuteInput } from './gateway-types.js';

const UUID = /^[0-9a-f]{8}-[0-9a-f]{4}-[1-8][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i;
const APP_CODE = /^[A-Z][A-Z0-9_]{2,63}$/;
const TASK_CODE = /^[A-Z][A-Z0-9_]{2,127}$/;
const OPERATION_ID = /^[A-Za-z0-9][A-Za-z0-9._:-]{7,127}$/;
const CONTEXT_KEYS = new Set(['userId', 'appCode', 'organizationId', 'platformRole']);
const INPUT_KEYS = new Set([
  'projectId', 'budgetId', 'operationId', 'taskType', 'input', 'classification',
  'confidentialMode',
]);

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === 'object' && value !== null && !Array.isArray(value);
}

export function validateTrustedAIGatewayContext(value: unknown): TrustedOrganizationContext {
  if (!isRecord(value) || Object.keys(value).some((key) => !CONTEXT_KEYS.has(key))) {
    throw new AIGatewayError('AI_GATEWAY_ACCESS_DENIED');
  }
  if (
    typeof value.userId !== 'string'
    || !UUID.test(value.userId)
    || typeof value.appCode !== 'string'
    || !APP_CODE.test(value.appCode)
    || typeof value.organizationId !== 'string'
    || !UUID.test(value.organizationId)
    || (value.platformRole !== undefined && value.platformRole !== 'PLATFORM_ADMIN')
  ) {
    throw new AIGatewayError('AI_GATEWAY_ACCESS_DENIED');
  }
  const context = value as unknown as TrustedAppContext;
  if (context.platformRole === 'PLATFORM_ADMIN') {
    throw new AIGatewayError('AI_GATEWAY_ACCESS_DENIED');
  }
  return {
    userId: value.userId.toLowerCase(),
    appCode: value.appCode,
    organizationId: value.organizationId.toLowerCase(),
  };
}

export function validateAIExecuteInput(value: unknown): ValidatedAIExecuteInput {
  if (!isRecord(value) || Object.keys(value).some((key) => !INPUT_KEYS.has(key))) {
    throw new AIGatewayError('AI_GATEWAY_INVALID_INPUT');
  }
  if (
    typeof value.projectId !== 'string'
    || !UUID.test(value.projectId)
    || typeof value.budgetId !== 'string'
    || !UUID.test(value.budgetId)
    || typeof value.operationId !== 'string'
    || !OPERATION_ID.test(value.operationId)
    || typeof value.taskType !== 'string'
    || !TASK_CODE.test(value.taskType)
    || !value.taskType.includes('_')
    || typeof value.input !== 'string'
    || value.input.trim().length === 0
    || value.input.length > 65_536
    || !DATA_CLASSIFICATIONS.includes(value.classification as DataClassification)
    || (value.confidentialMode !== undefined && typeof value.confidentialMode !== 'boolean')
  ) {
    throw new AIGatewayError('AI_GATEWAY_INVALID_INPUT');
  }
  return {
    projectId: value.projectId.toLowerCase(),
    budgetId: value.budgetId.toLowerCase(),
    operationId: value.operationId,
    taskType: value.taskType,
    input: value.input,
    classification: value.classification as DataClassification,
    confidentialMode: value.confidentialMode === true,
  };
}
