import type { TrustedAppContext } from '@green-hive/core';
import { ProjectError } from './errors.js';
import type {
  JsonValue,
  Project,
  ProjectRepository,
  ProjectSqlExecutor,
  ProjectStatus,
  ValidatedCreateProjectInput,
} from './types.js';

interface AuthorityRow extends Record<string, unknown> {
  readonly user_id: string | null;
  readonly app_code: string | null;
  readonly app_id: string | null;
  readonly organization_id: string | null;
  readonly has_trusted_organization_context: boolean;
  readonly is_platform_admin: boolean;
}

interface ProjectRow extends Record<string, unknown> {
  readonly id: string;
  readonly organization_id: string;
  readonly app_id: string;
  readonly owner_user_id: string;
  readonly name: string;
  readonly status: ProjectStatus;
  readonly metadata: Record<string, JsonValue>;
  readonly archived_at: Date | string | null;
  readonly deleted_at: Date | string | null;
  readonly created_at: Date | string;
  readonly updated_at: Date | string;
}

const PROJECT_COLUMNS = `
  id,
  organization_id,
  app_id,
  owner_user_id,
  name,
  status,
  metadata,
  archived_at,
  deleted_at,
  created_at,
  updated_at`;

function asDate(value: Date | string, field: string): Date {
  const parsed = value instanceof Date ? new Date(value.getTime()) : new Date(value);
  if (Number.isNaN(parsed.getTime())) throw new Error(`Invalid ${field}`);
  return parsed;
}

function asOptionalDate(value: Date | string | null, field: string): Date | null {
  return value === null ? null : asDate(value, field);
}

function mapProject(row: ProjectRow): Project {
  return {
    id: row.id,
    organizationId: row.organization_id,
    appId: row.app_id,
    ownerUserId: row.owner_user_id,
    name: row.name,
    status: row.status,
    metadata: row.metadata,
    archivedAt: asOptionalDate(row.archived_at, 'archived_at'),
    deletedAt: asOptionalDate(row.deleted_at, 'deleted_at'),
    createdAt: asDate(row.created_at, 'created_at'),
    updatedAt: asDate(row.updated_at, 'updated_at'),
  };
}

export class PostgresProjectRepository implements ProjectRepository {
  readonly #database: ProjectSqlExecutor;

  constructor(database: ProjectSqlExecutor) {
    this.#database = database;
  }

  async create(
    context: TrustedAppContext,
    input: ValidatedCreateProjectInput,
  ): Promise<Project> {
    const authority = await this.#assertAuthority(context, true);
    const result = await this.#database.query<ProjectRow>(
      `INSERT INTO hive.projects (organization_id, app_id, owner_user_id, name, metadata)
       VALUES ($1::uuid, $2::uuid, $3::uuid, $4, $5::jsonb)
       RETURNING ${PROJECT_COLUMNS}`,
      [
        authority.organization_id,
        authority.app_id,
        context.userId,
        input.name,
        JSON.stringify(input.metadata),
      ],
    );
    const row = result.rows[0];
    if (!row) throw new Error('Project insert returned no row');
    return mapProject(row);
  }

  async list(context: TrustedAppContext): Promise<readonly Project[]> {
    const authority = await this.#assertAuthority(context, false);
    const result = await this.#database.query<ProjectRow>(
      `SELECT ${PROJECT_COLUMNS}
       FROM hive.projects
       WHERE owner_user_id = $1::uuid
         AND app_id = $2::uuid
         AND organization_id = $3::uuid
         AND status <> 'DELETED'
       ORDER BY created_at, id`,
      [context.userId, authority.app_id, authority.organization_id],
    );
    return result.rows.map(mapProject);
  }

  async get(context: TrustedAppContext, projectId: string): Promise<Project | null> {
    const authority = await this.#assertAuthority(context, false);
    const result = await this.#database.query<ProjectRow>(
      `SELECT ${PROJECT_COLUMNS}
       FROM hive.projects
       WHERE id = $1::uuid
         AND owner_user_id = $2::uuid
         AND app_id = $3::uuid
         AND organization_id = $4::uuid
         AND status <> 'DELETED'`,
      [projectId, context.userId, authority.app_id, authority.organization_id],
    );
    const row = result.rows[0];
    return row ? mapProject(row) : null;
  }

  async archive(context: TrustedAppContext, projectId: string): Promise<Project | null> {
    const authority = await this.#assertAuthority(context, true);
    const result = await this.#database.query<ProjectRow>(
      `UPDATE hive.projects
       SET
         status = 'ARCHIVED',
         archived_at = CASE WHEN status = 'ARCHIVED' THEN archived_at ELSE now() END,
         updated_at = CASE WHEN status = 'ARCHIVED' THEN updated_at ELSE now() END
       WHERE id = $1::uuid
         AND owner_user_id = $2::uuid
         AND app_id = $3::uuid
         AND organization_id = $4::uuid
         AND status <> 'DELETED'
       RETURNING ${PROJECT_COLUMNS}`,
      [projectId, context.userId, authority.app_id, authority.organization_id],
    );
    const row = result.rows[0];
    return row ? mapProject(row) : null;
  }

  async softDelete(context: TrustedAppContext, projectId: string): Promise<boolean> {
    await this.#assertAuthority(context, true);
    const result = await this.#database.query<{ deleted: boolean }>(
      'SELECT hive.soft_delete_project($1::uuid) AS deleted',
      [projectId],
    );
    return result.rows[0]?.deleted === true;
  }

  async #assertAuthority(context: TrustedAppContext, write: boolean): Promise<AuthorityRow> {
    const result = await this.#database.query<AuthorityRow>(
      `SELECT
         auth.uid()::text AS user_id,
         hive.current_app_code() AS app_code,
         hive.current_app_id()::text AS app_id,
         hive.current_organization_id()::text AS organization_id,
         hive.has_trusted_organization_context() AS has_trusted_organization_context,
         hive.is_platform_admin() AS is_platform_admin`,
    );
    const authority = result.rows[0];
    if (
      !authority?.app_id ||
      !authority.organization_id ||
      !authority.has_trusted_organization_context ||
      authority.user_id !== context.userId ||
      authority.app_code !== context.appCode ||
      authority.organization_id !== context.organizationId ||
      (write && authority.is_platform_admin)
    ) {
      throw new ProjectError('PROJECT_ACCESS_DENIED');
    }
    return authority;
  }
}
