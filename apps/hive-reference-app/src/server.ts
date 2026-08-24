import {
  AccountService,
  AuthError,
  AuthService,
  PostgresAccountRepository,
  PostgresAuthenticatedSessionRunner,
  type AccountProfile,
  type AccountProfileInput,
  type AuthSession,
  type PasswordRecoveryChallenge,
  type VerifiedAuthIdentity,
} from '@green-hive/auth';
import {
  AuditService,
  PostgresAuditEventRepository,
  type AuditEvent,
} from '@green-hive/audit';
import {
  PostgresProjectRepository,
  PostgresWorkspaceRepository,
  ProjectService,
  WorkspaceService,
  type AddWorkspaceMemberInput,
  type CreateProjectInput,
  type CreateSharedWorkspaceInput,
  type Project,
  type RenameWorkspaceInput,
  type Workspace,
  type WorkspaceMember,
} from '@green-hive/projects';
import type { TrustedAppContext, TrustedOrganizationContext } from '@green-hive/core';
import {
  EntitlementService,
  PostgresEntitlementRepository,
  type ProjectEntitlement,
} from '@green-hive/entitlements';
import { referenceAppManifest } from './manifest.js';

export interface ReferenceAppCredentialsInput {
  readonly email: string;
  readonly password: string;
}

export interface ReferenceAppSignUpInput extends ReferenceAppCredentialsInput {
  readonly displayName?: string;
  readonly preferredLanguage?: string;
  readonly preferredLocale?: string;
  readonly timezone?: string;
  readonly organizationName?: string;
}

export interface ReferenceAppAccountView {
  readonly email: string;
  readonly profile: AccountProfile;
}

export interface ReferenceAppRefreshInput {
  readonly refreshToken: string;
}

export interface ReferenceAppRecoveryInput {
  readonly email: string;
}

export interface ReferenceAppRecoveryCompletionInput {
  readonly accessToken: string;
  readonly refreshToken: string;
  readonly newPassword: string;
}

export interface ReferenceAppRecoveryCodeExchangeInput {
  readonly code: string;
  readonly state: string;
  readonly flowId?: string;
}

export interface ReferenceAppSignOutInput {
  readonly accessToken: string;
  readonly scope?: 'local' | 'global';
}

export interface ReferenceAppServerOptions {
  readonly authService: AuthService;
  readonly sessionRunner: PostgresAuthenticatedSessionRunner;
  readonly recoveryRedirectUrl: string;
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === 'object' && value !== null && !Array.isArray(value);
}

function assertOnlyKeys(value: unknown, keys: ReadonlySet<string>): Record<string, unknown> {
  if (!isRecord(value) || Object.keys(value).some((key) => !keys.has(key))) {
    throw new AuthError('INVALID_AUTH_INPUT');
  }
  return value;
}

export class ReferenceAppServer {
  readonly #authService: AuthService;
  readonly #sessionRunner: PostgresAuthenticatedSessionRunner;
  readonly #recoveryRedirectUrl: string;

  constructor(options: ReferenceAppServerOptions) {
    this.#authService = options.authService;
    this.#sessionRunner = options.sessionRunner;
    this.#recoveryRedirectUrl = new URL(options.recoveryRedirectUrl).toString();
  }

  async signUp(input: ReferenceAppSignUpInput): Promise<AuthSession> {
    const credentials = assertOnlyKeys(input, new Set([
      'email',
      'password',
      'displayName',
      'preferredLanguage',
      'preferredLocale',
      'timezone',
      'organizationName',
    ]));
    const session = await this.#authService.signUp({
      email: credentials.email as string,
      password: credentials.password as string,
      appCode: referenceAppManifest.appCode,
    });
    await this.#runWithoutWorkspace(session.accessToken, async ({
      accountService,
      workspaceService,
      trustedContext,
    }) => {
      await accountService.ensure(trustedContext, {
        ...(credentials.displayName === undefined
          ? {}
          : { displayName: credentials.displayName as string }),
        ...(credentials.preferredLanguage === undefined
          ? {}
          : { preferredLanguage: credentials.preferredLanguage as string }),
        ...(credentials.preferredLocale === undefined
          ? {}
          : { preferredLocale: credentials.preferredLocale as string }),
        ...(credentials.timezone === undefined
          ? {}
          : { timezone: credentials.timezone as string }),
      });
      await workspaceService.ensurePersonal(
        trustedContext,
        credentials.organizationName === undefined
          ? 'Personal Workspace'
          : credentials.organizationName as string,
      );
    });
    return session;
  }

  async signIn(input: ReferenceAppCredentialsInput): Promise<AuthSession> {
    const credentials = assertOnlyKeys(input, new Set(['email', 'password']));
    const session = await this.#authService.signIn({
      email: credentials.email as string,
      password: credentials.password as string,
      appCode: referenceAppManifest.appCode,
    });
    await this.#runWithoutWorkspace(session.accessToken, async ({
      accountService,
      workspaceService,
      trustedContext,
    }) => {
      await accountService.ensure(trustedContext);
      await workspaceService.ensurePersonal(trustedContext);
    });
    return session;
  }

  async refreshSession(input: ReferenceAppRefreshInput): Promise<AuthSession> {
    const value = assertOnlyKeys(input, new Set(['refreshToken']));
    return this.#authService.refreshSession({
      refreshToken: value.refreshToken as string,
      appCode: referenceAppManifest.appCode,
    });
  }

  async signOut(input: ReferenceAppSignOutInput): Promise<void> {
    const value = assertOnlyKeys(input, new Set(['accessToken', 'scope']));
    await this.#authService.signOut({
      accessToken: value.accessToken as string,
      ...(value.scope === undefined ? {} : { scope: value.scope as 'local' | 'global' }),
    });
  }

  async requestPasswordRecovery(
    input: ReferenceAppRecoveryInput,
  ): Promise<PasswordRecoveryChallenge> {
    const value = assertOnlyKeys(input, new Set(['email']));
    return this.#authService.requestPasswordRecovery({
      email: value.email as string,
      redirectTo: this.#recoveryRedirectUrl,
    });
  }

  async exchangePasswordRecoveryCode(
    input: ReferenceAppRecoveryCodeExchangeInput,
  ): Promise<AuthSession> {
    const value = assertOnlyKeys(input, new Set(['code', 'state', 'flowId']));
    return this.#authService.exchangePasswordRecoveryCode({
      code: value.code as string,
      state: value.state as string,
      ...(value.flowId === undefined ? {} : { flowId: value.flowId as string }),
      appCode: referenceAppManifest.appCode,
    });
  }

  async completePasswordRecovery(input: ReferenceAppRecoveryCompletionInput): Promise<void> {
    const value = assertOnlyKeys(input, new Set(['accessToken', 'refreshToken', 'newPassword']));
    await this.#authService.completePasswordRecovery({
      accessToken: value.accessToken as string,
      refreshToken: value.refreshToken as string,
      newPassword: value.newPassword as string,
    });
  }

  async getMe(accessToken: string): Promise<AccountProfile> {
    return this.#runWithoutWorkspace(accessToken, ({ accountService, trustedContext }) =>
      accountService.get(trustedContext),
    );
  }

  async getAccount(accessToken: string): Promise<ReferenceAppAccountView> {
    return this.#runWithoutWorkspace(
      accessToken,
      async ({ accountService, identity, trustedContext }) => ({
        email: identity.email,
        profile: await accountService.get(trustedContext),
      }),
    );
  }

  async updateMe(accessToken: string, input: AccountProfileInput): Promise<AccountProfile> {
    return this.#runWithoutWorkspace(accessToken, ({ accountService, trustedContext }) =>
      accountService.update(trustedContext, input),
    );
  }

  async listWorkspaces(accessToken: string): Promise<readonly Workspace[]> {
    return this.#runWithoutWorkspace(accessToken, ({ workspaceService, trustedContext }) =>
      workspaceService.list(trustedContext),
    );
  }

  async createSharedWorkspace(
    accessToken: string,
    input: CreateSharedWorkspaceInput,
  ): Promise<Workspace> {
    return this.#runWithoutWorkspace(accessToken, ({ workspaceService, trustedContext }) =>
      workspaceService.createShared(trustedContext, input),
    );
  }

  async renameWorkspace(
    accessToken: string,
    organizationId: string,
    input: RenameWorkspaceInput,
  ): Promise<Workspace> {
    return this.#runInWorkspace(
      accessToken,
      organizationId,
      ({ workspaceService, trustedContext }) => workspaceService.rename(trustedContext, input),
    );
  }

  async listWorkspaceMembers(
    accessToken: string,
    organizationId: string,
  ): Promise<readonly WorkspaceMember[]> {
    return this.#runInWorkspace(
      accessToken,
      organizationId,
      ({ workspaceService, trustedContext }) => workspaceService.listMembers(trustedContext),
    );
  }

  async addWorkspaceMember(
    accessToken: string,
    organizationId: string,
    input: AddWorkspaceMemberInput,
  ): Promise<WorkspaceMember> {
    return this.#runInWorkspace(
      accessToken,
      organizationId,
      ({ workspaceService, trustedContext }) => workspaceService.addMember(trustedContext, input),
    );
  }

  async listAuditEvents(
    accessToken: string,
    organizationId: string,
  ): Promise<readonly AuditEvent[]> {
    return this.#runInWorkspace(
      accessToken,
      organizationId,
      ({ auditService, trustedContext }) => auditService.list(trustedContext, { limit: 50 }),
    );
  }

  async createProject(
    accessToken: string,
    organizationId: string,
    input: CreateProjectInput,
  ): Promise<Project> {
    return this.#runInWorkspace(accessToken, organizationId, ({ projectService, trustedContext }) =>
      projectService.create(trustedContext, input),
    );
  }

  async listProjects(accessToken: string, organizationId: string): Promise<readonly Project[]> {
    return this.#runInWorkspace(accessToken, organizationId, ({ projectService, trustedContext }) =>
      projectService.list(trustedContext),
    );
  }

  async getProject(
    accessToken: string,
    organizationId: string,
    projectId: string,
  ): Promise<Project> {
    return this.#runInWorkspace(accessToken, organizationId, ({ projectService, trustedContext }) =>
      projectService.get(trustedContext, projectId),
    );
  }

  async archiveProject(
    accessToken: string,
    organizationId: string,
    projectId: string,
  ): Promise<Project> {
    return this.#runInWorkspace(accessToken, organizationId, ({ projectService, trustedContext }) =>
      projectService.archive(trustedContext, projectId),
    );
  }

  async softDeleteProject(
    accessToken: string,
    organizationId: string,
    projectId: string,
  ): Promise<void> {
    await this.#runInWorkspace(accessToken, organizationId, ({ projectService, trustedContext }) =>
      projectService.softDelete(trustedContext, projectId),
    );
  }

  async canProjectCapability(
    accessToken: string,
    organizationId: string,
    projectId: string,
    capabilityCode: string,
  ): Promise<boolean> {
    return this.#runInWorkspace(
      accessToken,
      organizationId,
      ({ entitlementService, trustedContext }) =>
        entitlementService.can(trustedContext, projectId, capabilityCode),
    );
  }

  async listProjectEntitlements(
    accessToken: string,
    organizationId: string,
    projectId: string,
  ): Promise<readonly ProjectEntitlement[]> {
    return this.#runInWorkspace(
      accessToken,
      organizationId,
      ({ entitlementService, trustedContext }) =>
        entitlementService.list(trustedContext, projectId),
    );
  }

  async #runWithoutWorkspace<Result>(
    accessToken: string,
    operation: (services: {
      readonly identity: VerifiedAuthIdentity;
      readonly trustedContext: TrustedAppContext;
      readonly accountService: AccountService;
      readonly workspaceService: WorkspaceService;
    }) => Promise<Result>,
  ): Promise<Result> {
    const verified = await this.#trustedContext(accessToken);
    return this.#sessionRunner.run(verified.identity, ({ trustedContext, database }) =>
      operation({
        identity: verified.identity,
        trustedContext,
        accountService: new AccountService(new PostgresAccountRepository(database)),
        workspaceService: new WorkspaceService(new PostgresWorkspaceRepository(database)),
      }),
    );
  }

  async #runInWorkspace<Result>(
    accessToken: string,
    organizationId: string,
    operation: (services: {
      readonly trustedContext: TrustedOrganizationContext;
      readonly auditService: AuditService;
      readonly entitlementService: EntitlementService;
      readonly projectService: ProjectService;
      readonly workspaceService: WorkspaceService;
    }) => Promise<Result>,
  ): Promise<Result> {
    const verified = await this.#trustedContext(accessToken);
    return this.#sessionRunner.runInOrganization(
      verified.identity,
      organizationId,
      ({ trustedContext, database }) => operation({
        trustedContext,
        auditService: new AuditService(new PostgresAuditEventRepository(database)),
        entitlementService: new EntitlementService(new PostgresEntitlementRepository(database)),
        projectService: new ProjectService(new PostgresProjectRepository(database)),
        workspaceService: new WorkspaceService(new PostgresWorkspaceRepository(database)),
      }),
    );
  }

  async #trustedContext(accessToken: string) {
    const identity = await this.#authService.verifyAccessTokenForApp(
      accessToken,
      referenceAppManifest.appCode,
    );
    return {
      identity,
      trustedContext: {
        userId: identity.id,
        appCode: identity.appCode,
        ...(identity.platformRole === undefined ? {} : { platformRole: identity.platformRole }),
      },
    } as const;
  }
}
