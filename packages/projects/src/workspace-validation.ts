import type { TrustedAppContext, TrustedOrganizationContext } from '@green-hive/core';
import { WorkspaceError } from './workspace-errors.js';
import type {
  AddWorkspaceMemberInput,
  AssignableWorkspaceRole,
  CreateSharedWorkspaceInput,
  RenameWorkspaceInput,
} from './workspace-types.js';

const UUID = /^[0-9a-f]{8}-[0-9a-f]{4}-[1-8][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i;
const APP_CODE = /^[A-Z][A-Z0-9_]{2,63}$/;
const CONTEXT_KEYS = new Set(['userId', 'appCode', 'organizationId', 'platformRole']);
const CREATE_KEYS = new Set(['name']);
const MEMBER_KEYS = new Set(['userId', 'role']);
const ASSIGNABLE_ROLES = new Set<AssignableWorkspaceRole>([
  'ADMIN',
  'DEVELOPER',
  'ANALYST',
  'VIEWER',
]);

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === 'object' && value !== null && !Array.isArray(value);
}

export function validateWorkspaceContext(value: unknown): TrustedAppContext {
  if (!isRecord(value) || Object.keys(value).some((key) => !CONTEXT_KEYS.has(key))) {
    throw new WorkspaceError('WORKSPACE_ACCESS_DENIED');
  }
  if (typeof value.userId !== 'string' || !UUID.test(value.userId)) {
    throw new WorkspaceError('WORKSPACE_ACCESS_DENIED');
  }
  if (typeof value.appCode !== 'string' || !APP_CODE.test(value.appCode)) {
    throw new WorkspaceError('WORKSPACE_ACCESS_DENIED');
  }
  if (value.organizationId !== undefined && (
    typeof value.organizationId !== 'string' || !UUID.test(value.organizationId)
  )) {
    throw new WorkspaceError('WORKSPACE_ACCESS_DENIED');
  }
  if (value.platformRole !== undefined && value.platformRole !== 'PLATFORM_ADMIN') {
    throw new WorkspaceError('WORKSPACE_ACCESS_DENIED');
  }
  return {
    userId: value.userId.toLowerCase(),
    appCode: value.appCode,
    ...(value.organizationId === undefined
      ? {}
      : { organizationId: value.organizationId.toLowerCase() }),
    ...(value.platformRole === undefined ? {} : { platformRole: value.platformRole }),
  };
}

export function validateWorkspaceOrganizationContext(
  value: unknown,
): TrustedOrganizationContext {
  const context = validateWorkspaceContext(value);
  if (!context.organizationId) throw new WorkspaceError('WORKSPACE_ACCESS_DENIED');
  return { ...context, organizationId: context.organizationId };
}

export function validateCreateSharedWorkspaceInput(value: unknown): string {
  if (!isRecord(value) || Object.keys(value).some((key) => !CREATE_KEYS.has(key))) {
    throw new WorkspaceError('INVALID_WORKSPACE_INPUT');
  }
  if (typeof value.name !== 'string') throw new WorkspaceError('INVALID_WORKSPACE_INPUT');
  const name = value.name.trim();
  if (name.length < 1 || name.length > 160) {
    throw new WorkspaceError('INVALID_WORKSPACE_INPUT');
  }
  return name;
}

export function validatePersonalWorkspaceName(value: unknown): string {
  if (typeof value !== 'string') throw new WorkspaceError('INVALID_WORKSPACE_INPUT');
  const name = value.trim();
  if (name.length < 1 || name.length > 160) {
    throw new WorkspaceError('INVALID_WORKSPACE_INPUT');
  }
  return name;
}

export function validateRenameWorkspaceInput(value: unknown): string {
  return validateCreateSharedWorkspaceInput(value);
}

export function validateAddWorkspaceMemberInput(value: unknown): AddWorkspaceMemberInput {
  if (!isRecord(value) || Object.keys(value).some((key) => !MEMBER_KEYS.has(key))) {
    throw new WorkspaceError('INVALID_WORKSPACE_INPUT');
  }
  if (typeof value.userId !== 'string' || !UUID.test(value.userId)) {
    throw new WorkspaceError('INVALID_WORKSPACE_INPUT');
  }
  if (typeof value.role !== 'string' || !ASSIGNABLE_ROLES.has(value.role as AssignableWorkspaceRole)) {
    throw new WorkspaceError('INVALID_WORKSPACE_INPUT');
  }
  return {
    userId: value.userId.toLowerCase(),
    role: value.role as AssignableWorkspaceRole,
  };
}

export function createSharedWorkspaceInput(name: string): CreateSharedWorkspaceInput {
  return { name };
}

export function renameWorkspaceInput(name: string): RenameWorkspaceInput {
  return { name };
}
