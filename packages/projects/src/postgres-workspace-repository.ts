import type { TrustedAppContext, TrustedOrganizationContext } from '@green-hive/core';
import { WorkspaceError } from './workspace-errors.js';
import type {
  AddWorkspaceMemberInput,
  AppRelationship,
  Workspace,
  WorkspaceKind,
  WorkspaceMember,
  WorkspaceRepository,
  WorkspaceRole,
  WorkspaceStatus,
} from './workspace-types.js';
import type { ProjectSqlExecutor } from './types.js';

interface WorkspaceRow extends Record<string, unknown> {
  readonly id: string;
  readonly name: string;
  readonly slug: string;
  readonly kind: WorkspaceKind;
  readonly status: WorkspaceStatus;
  readonly role: WorkspaceRole;
  readonly app_relationship: AppRelationship;
  readonly created_at: Date | string;
  readonly updated_at: Date | string;
}

interface WorkspaceMemberRow extends Record<string, unknown> {
  readonly organization_id: string;
  readonly user_id: string;
  readonly role: WorkspaceRole;
  readonly status: 'ACTIVE' | 'SUSPENDED';
  readonly joined_at: Date | string;
  readonly updated_at: Date | string;
}

interface IdRow extends Record<string, unknown> {
  readonly id: string;
}

interface WorkspaceAuthorityRow extends Record<string, unknown> {
  readonly user_id: string | null;
  readonly app_code: string | null;
  readonly organization_id: string | null;
  readonly role: WorkspaceRole | null;
  readonly trusted: boolean;
}

const WORKSPACE_SELECT = `
  SELECT
    organizations.id,
    organizations.name,
    organizations.slug,
    organizations.kind,
    organizations.status,
    members.role,
    installations.relationship AS app_relationship,
    organizations.created_at,
    organizations.updated_at
  FROM hive.organizations AS organizations
  JOIN hive.organization_members AS members
    ON members.organization_id = organizations.id
  JOIN hive.organization_apps AS installations
    ON installations.organization_id = organizations.id
  WHERE members.user_id = $1::uuid
    AND members.status = 'ACTIVE'
    AND organizations.status = 'ACTIVE'
    AND installations.app_id = hive.current_app_id()
    AND installations.status = 'ACTIVE'`;

function asDate(value: Date | string): Date {
  const parsed = value instanceof Date ? new Date(value.getTime()) : new Date(value);
  if (Number.isNaN(parsed.getTime())) throw new Error('Invalid workspace timestamp');
  return parsed;
}

function mapWorkspace(row: WorkspaceRow): Workspace {
  return {
    id: row.id,
    name: row.name,
    slug: row.slug,
    kind: row.kind,
    status: row.status,
    role: row.role,
    appRelationship: row.app_relationship,
    createdAt: asDate(row.created_at),
    updatedAt: asDate(row.updated_at),
  };
}

function mapMember(row: WorkspaceMemberRow): WorkspaceMember {
  return {
    organizationId: row.organization_id,
    userId: row.user_id,
    role: row.role,
    status: row.status,
    joinedAt: asDate(row.joined_at),
    updatedAt: asDate(row.updated_at),
  };
}

export class PostgresWorkspaceRepository implements WorkspaceRepository {
  readonly #database: ProjectSqlExecutor;

  constructor(database: ProjectSqlExecutor) {
    this.#database = database;
  }

  async ensurePersonal(context: TrustedAppContext, name: string): Promise<Workspace> {
    await this.#assertBaseAuthority(context);
    const ensured = await this.#database.query<IdRow>(
      'SELECT hive.ensure_personal_organization($1)::text AS id',
      [name],
    );
    const organizationId = ensured.rows[0]?.id;
    if (!organizationId) throw new Error('Personal workspace provisioning returned no row');
    return this.#getVisibleWorkspace(context, organizationId);
  }

  async list(context: TrustedAppContext): Promise<readonly Workspace[]> {
    await this.#assertBaseAuthority(context);
    const result = await this.#database.query<WorkspaceRow>(
      `${WORKSPACE_SELECT}
       ORDER BY organizations.kind, organizations.created_at, organizations.id`,
      [context.userId],
    );
    return result.rows.map(mapWorkspace);
  }

  async createShared(context: TrustedAppContext, name: string): Promise<Workspace> {
    await this.#assertBaseAuthority(context);
    const created = await this.#database.query<IdRow>(
      'SELECT hive.create_shared_organization($1)::text AS id',
      [name],
    );
    const organizationId = created.rows[0]?.id;
    if (!organizationId) throw new Error('Shared workspace creation returned no row');
    return this.#getVisibleWorkspace(context, organizationId);
  }

  async rename(context: TrustedOrganizationContext, name: string): Promise<Workspace> {
    await this.#assertOrganizationAuthority(context, true);
    const updated = await this.#database.query<IdRow>(
      `UPDATE hive.organizations
       SET name = $2, updated_at = now()
       WHERE id = $1::uuid
         AND kind = 'SHARED'
       RETURNING id::text AS id`,
      [context.organizationId, name],
    );
    if (!updated.rows[0]?.id) throw new WorkspaceError('WORKSPACE_ACCESS_DENIED');
    return this.#getVisibleWorkspace(context, context.organizationId);
  }

  async listMembers(
    context: TrustedOrganizationContext,
  ): Promise<readonly WorkspaceMember[]> {
    await this.#assertOrganizationAuthority(context, false);
    const result = await this.#database.query<WorkspaceMemberRow>(
      `SELECT
         organization_id::text AS organization_id,
         user_id::text AS user_id,
         role,
         status,
         joined_at,
         updated_at
       FROM hive.organization_members
       WHERE organization_id = $1::uuid
       ORDER BY joined_at, user_id`,
      [context.organizationId],
    );
    return result.rows.map(mapMember);
  }

  async addMember(
    context: TrustedOrganizationContext,
    input: AddWorkspaceMemberInput,
  ): Promise<WorkspaceMember> {
    await this.#assertOrganizationAuthority(context, true);
    const result = await this.#database.query<WorkspaceMemberRow>(
      `INSERT INTO hive.organization_members (organization_id, user_id, role)
       VALUES ($1::uuid, $2::uuid, $3)
       ON CONFLICT (organization_id, user_id) DO UPDATE
       SET role = EXCLUDED.role, status = 'ACTIVE', updated_at = now()
       RETURNING
         organization_id::text AS organization_id,
         user_id::text AS user_id,
         role,
         status,
         joined_at,
         updated_at`,
      [context.organizationId, input.userId, input.role],
    );
    const member = result.rows[0];
    if (!member) throw new WorkspaceError('WORKSPACE_ACCESS_DENIED');
    return mapMember(member);
  }

  async #getVisibleWorkspace(
    context: TrustedAppContext,
    organizationId: string,
  ): Promise<Workspace> {
    const result = await this.#database.query<WorkspaceRow>(
      `${WORKSPACE_SELECT}
       AND organizations.id = $2::uuid`,
      [context.userId, organizationId],
    );
    const workspace = result.rows[0];
    if (!workspace) throw new WorkspaceError('WORKSPACE_NOT_FOUND');
    return mapWorkspace(workspace);
  }

  async #assertBaseAuthority(context: TrustedAppContext): Promise<void> {
    const result = await this.#database.query<WorkspaceAuthorityRow>(
      `SELECT
         auth.uid()::text AS user_id,
         hive.current_app_code() AS app_code,
         NULL::text AS organization_id,
         NULL::text AS role,
         hive.has_trusted_app_context() AS trusted`,
    );
    const authority = result.rows[0];
    if (
      !authority?.trusted ||
      authority.user_id !== context.userId ||
      authority.app_code !== context.appCode
    ) {
      throw new WorkspaceError('WORKSPACE_ACCESS_DENIED');
    }
  }

  async #assertOrganizationAuthority(
    context: TrustedOrganizationContext,
    requireAdministration: boolean,
  ): Promise<void> {
    const result = await this.#database.query<WorkspaceAuthorityRow>(
      `SELECT
         auth.uid()::text AS user_id,
         hive.current_app_code() AS app_code,
         hive.current_organization_id()::text AS organization_id,
         members.role,
         hive.has_trusted_organization_context() AS trusted
       FROM hive.organization_members AS members
       WHERE members.organization_id = hive.current_organization_id()
         AND members.user_id = auth.uid()
         AND members.status = 'ACTIVE'`,
    );
    const authority = result.rows[0];
    if (
      !authority?.trusted ||
      authority.user_id !== context.userId ||
      authority.app_code !== context.appCode ||
      authority.organization_id !== context.organizationId ||
      (requireAdministration && authority.role !== 'OWNER' && authority.role !== 'ADMIN')
    ) {
      throw new WorkspaceError('WORKSPACE_ACCESS_DENIED');
    }
  }
}
