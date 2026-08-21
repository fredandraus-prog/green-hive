import type { TrustedAppContext } from '@green-hive/core';

export const PROJECT_STATUSES = ['DRAFT', 'ACTIVE', 'ARCHIVED', 'DELETED'] as const;
export type ProjectStatus = (typeof PROJECT_STATUSES)[number];

export type JsonValue =
  | null
  | boolean
  | number
  | string
  | readonly JsonValue[]
  | { readonly [key: string]: JsonValue };

export interface Project {
  readonly id: string;
  readonly organizationId: string;
  readonly appId: string;
  readonly ownerUserId: string;
  readonly name: string;
  readonly status: ProjectStatus;
  readonly metadata: Readonly<Record<string, JsonValue>>;
  readonly archivedAt: Date | null;
  readonly deletedAt: Date | null;
  readonly createdAt: Date;
  readonly updatedAt: Date;
}

export interface CreateProjectInput {
  readonly name: string;
  readonly metadata?: Readonly<Record<string, JsonValue>>;
}

export interface ValidatedCreateProjectInput {
  readonly name: string;
  readonly metadata: Readonly<Record<string, JsonValue>>;
}

export interface ProjectRepository {
  create(
    context: TrustedAppContext,
    input: ValidatedCreateProjectInput,
  ): Promise<Project>;
  list(context: TrustedAppContext): Promise<readonly Project[]>;
  get(context: TrustedAppContext, projectId: string): Promise<Project | null>;
  archive(context: TrustedAppContext, projectId: string): Promise<Project | null>;
  softDelete(context: TrustedAppContext, projectId: string): Promise<boolean>;
}

export interface ProjectSqlResult<Row> {
  readonly rows: readonly Row[];
}

export interface ProjectSqlExecutor {
  query<Row extends Record<string, unknown> = Record<string, unknown>>(
    sql: string,
    parameters?: readonly unknown[],
  ): Promise<ProjectSqlResult<Row>>;
}
