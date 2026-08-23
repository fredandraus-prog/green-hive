import type { TrustedAppContext, TrustedOrganizationContext } from '@green-hive/core';

export const WORKSPACE_KINDS = ['PERSONAL', 'SHARED'] as const;
export type WorkspaceKind = (typeof WORKSPACE_KINDS)[number];

export const WORKSPACE_STATUSES = ['ACTIVE', 'ARCHIVED'] as const;
export type WorkspaceStatus = (typeof WORKSPACE_STATUSES)[number];

export const WORKSPACE_ROLES = ['OWNER', 'ADMIN', 'DEVELOPER', 'ANALYST', 'VIEWER'] as const;
export type WorkspaceRole = (typeof WORKSPACE_ROLES)[number];
export type AssignableWorkspaceRole = Exclude<WorkspaceRole, 'OWNER'>;

export const APP_RELATIONSHIPS = ['NATIVE', 'CONNECTED', 'MIGRATING'] as const;
export type AppRelationship = (typeof APP_RELATIONSHIPS)[number];

export interface Workspace {
  readonly id: string;
  readonly name: string;
  readonly slug: string;
  readonly kind: WorkspaceKind;
  readonly status: WorkspaceStatus;
  readonly role: WorkspaceRole;
  readonly appRelationship: AppRelationship;
  readonly createdAt: Date;
  readonly updatedAt: Date;
}

export interface WorkspaceMember {
  readonly organizationId: string;
  readonly userId: string;
  readonly role: WorkspaceRole;
  readonly status: 'ACTIVE' | 'SUSPENDED';
  readonly joinedAt: Date;
  readonly updatedAt: Date;
}

export interface CreateSharedWorkspaceInput {
  readonly name: string;
}

export interface RenameWorkspaceInput {
  readonly name: string;
}

export interface AddWorkspaceMemberInput {
  readonly userId: string;
  readonly role: AssignableWorkspaceRole;
}

export interface WorkspaceRepository {
  ensurePersonal(context: TrustedAppContext, name: string): Promise<Workspace>;
  list(context: TrustedAppContext): Promise<readonly Workspace[]>;
  createShared(context: TrustedAppContext, name: string): Promise<Workspace>;
  rename(context: TrustedOrganizationContext, name: string): Promise<Workspace>;
  listMembers(context: TrustedOrganizationContext): Promise<readonly WorkspaceMember[]>;
  addMember(
    context: TrustedOrganizationContext,
    input: AddWorkspaceMemberInput,
  ): Promise<WorkspaceMember>;
}
