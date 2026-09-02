import type { TrustedAppContext, TrustedOrganizationContext } from '@green-hive/core';
import { DATA_CLASSIFICATIONS, type DataClassification } from '@green-hive/trust';
import { SearchGatewayError } from './errors.js';
import type { SearchExecuteInput, ValidatedSearchExecuteInput } from './types.js';
import { SEARCH_MAX_QUERY_CHARACTERS } from './validation.js';

const UUID = /^[0-9a-f]{8}-[0-9a-f]{4}-[1-8][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i;
const APP_CODE = /^[A-Z][A-Z0-9_]{2,63}$/;
const SEARCH_TYPE = /^[A-Z][A-Z0-9_]{2,127}$/;
const OPERATION_ID = /^[A-Za-z0-9][A-Za-z0-9._:-]{7,127}$/;
const CONTEXT_KEYS = new Set(['userId', 'appCode', 'organizationId', 'platformRole']);
const INPUT_KEYS = new Set([
  'projectId',
  'budgetId',
  'operationId',
  'searchType',
  'query',
  'classification',
  'confidentialMode',
]);

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === 'object' && value !== null && !Array.isArray(value);
}

export function validateTrustedSearchGatewayContext(value: unknown): TrustedOrganizationContext {
  if (!isRecord(value) || Object.keys(value).some((key) => !CONTEXT_KEYS.has(key))) {
    throw new SearchGatewayError('SEARCH_GATEWAY_ACCESS_DENIED');
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
    throw new SearchGatewayError('SEARCH_GATEWAY_ACCESS_DENIED');
  }
  const context = value as unknown as TrustedAppContext;
  if (context.platformRole === 'PLATFORM_ADMIN') {
    throw new SearchGatewayError('SEARCH_GATEWAY_ACCESS_DENIED');
  }
  return Object.freeze({
    userId: value.userId.toLowerCase(),
    appCode: value.appCode,
    organizationId: value.organizationId.toLowerCase(),
  });
}

export function validateSearchExecuteInput(value: unknown): ValidatedSearchExecuteInput {
  if (!isRecord(value) || Object.keys(value).some((key) => !INPUT_KEYS.has(key))) {
    throw new SearchGatewayError('SEARCH_GATEWAY_INVALID_INPUT');
  }
  if (
    typeof value.projectId !== 'string'
    || !UUID.test(value.projectId)
    || typeof value.budgetId !== 'string'
    || !UUID.test(value.budgetId)
    || typeof value.operationId !== 'string'
    || !OPERATION_ID.test(value.operationId)
    || typeof value.searchType !== 'string'
    || !SEARCH_TYPE.test(value.searchType)
    || !value.searchType.includes('_')
    || typeof value.query !== 'string'
    || value.query.trim().length === 0
    || value.query.length > SEARCH_MAX_QUERY_CHARACTERS
    || !DATA_CLASSIFICATIONS.includes(value.classification as DataClassification)
    || (value.confidentialMode !== undefined && typeof value.confidentialMode !== 'boolean')
  ) {
    throw new SearchGatewayError('SEARCH_GATEWAY_INVALID_INPUT');
  }
  return Object.freeze({
    projectId: value.projectId.toLowerCase(),
    budgetId: value.budgetId.toLowerCase(),
    operationId: value.operationId,
    searchType: value.searchType,
    query: value.query,
    classification: value.classification as DataClassification,
    confidentialMode: value.confidentialMode === true,
  });
}
