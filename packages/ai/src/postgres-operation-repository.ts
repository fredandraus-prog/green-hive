import type { TrustedOrganizationContext } from '@green-hive/core';
import { AIGatewayError } from './errors.js';
import type {
  AIOperationCompleteInput,
  AIOperationFailInput,
  AIOperationRepository,
  AIOperationStartInput,
  AISqlExecutor,
} from './gateway-types.js';

interface AuthorityRow extends Record<string, unknown> {
  readonly user_id: string | null;
  readonly app_code: string | null;
  readonly app_id: string | null;
  readonly organization_id: string | null;
  readonly trusted: boolean;
  readonly is_platform_admin: boolean;
}

function mapDatabaseError(error: unknown): never {
  const message = error instanceof Error ? error.message : '';
  for (const code of [
    'AI_GATEWAY_ACCESS_DENIED',
    'AI_GATEWAY_INVALID_INPUT',
    'AI_GATEWAY_OPERATION_CONFLICT',
  ] as const) {
    if (message.includes(code)) throw new AIGatewayError(code);
  }
  throw new AIGatewayError('AI_GATEWAY_OPERATION_FAILED');
}

export class PostgresAIOperationRepository implements AIOperationRepository {
  readonly #database: AISqlExecutor;

  constructor(database: AISqlExecutor) {
    this.#database = database;
  }

  async start(context: TrustedOrganizationContext, input: AIOperationStartInput): Promise<void> {
    await this.#assertAuthority(context);
    try {
      await this.#database.query(
        `SELECT hive.start_ai_operation(
           $1::uuid, $2::text, $3::text, $4::text, $5::text, $6::text,
           $7::text, $8::text, $9::text, $10::text, $11::text, $12::text,
           $13::numeric, $14::text
         )`,
        [
          input.projectId, input.operationId, input.taskType, input.outputMode,
          input.outputSchemaId, input.classification, input.providerCode, input.modelCode,
          input.trustPolicyCode, input.trustDecision, input.sanitizationMode,
          input.requestFingerprint, input.estimatedCost, input.currency,
        ],
      );
    } catch (error) {
      mapDatabaseError(error);
    }
  }

  async complete(context: TrustedOrganizationContext, input: AIOperationCompleteInput): Promise<void> {
    await this.#assertAuthority(context);
    try {
      await this.#database.query(
        `SELECT hive.complete_ai_operation(
           $1::text, $2::text, $3::integer, $4::integer, $5::numeric
         )`,
        [
          input.operationId, input.finishReason, input.inputTokens,
          input.outputTokens, input.actualCost,
        ],
      );
    } catch (error) {
      mapDatabaseError(error);
    }
  }

  async fail(context: TrustedOrganizationContext, input: AIOperationFailInput): Promise<void> {
    await this.#assertAuthority(context);
    try {
      await this.#database.query(
        'SELECT hive.fail_ai_operation($1::text, $2::text)',
        [input.operationId, input.errorCode],
      );
    } catch (error) {
      mapDatabaseError(error);
    }
  }

  async #assertAuthority(context: TrustedOrganizationContext): Promise<void> {
    const result = await this.#database.query<AuthorityRow>(
      `SELECT
         auth.uid()::text AS user_id,
         hive.current_app_code() AS app_code,
         hive.current_app_id()::text AS app_id,
         hive.current_organization_id()::text AS organization_id,
         hive.has_trusted_organization_context() AS trusted,
         hive.is_platform_admin() AS is_platform_admin`,
    );
    const authority = result.rows[0];
    if (
      !authority?.trusted
      || authority.is_platform_admin
      || authority.user_id !== context.userId
      || authority.app_code !== context.appCode
      || authority.organization_id !== context.organizationId
      || !authority.app_id
    ) {
      throw new AIGatewayError('AI_GATEWAY_ACCESS_DENIED');
    }
  }
}
