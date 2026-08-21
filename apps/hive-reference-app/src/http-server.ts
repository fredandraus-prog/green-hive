import cookie from '@fastify/cookie';
import fastifyStatic from '@fastify/static';
import Fastify, {
  type FastifyInstance,
  type FastifyReply,
  type FastifyRequest,
} from 'fastify';
import { AuthError, type AuthSession } from '@green-hive/auth';
import { AuditError } from '@green-hive/audit';
import {
  ProjectError,
  WorkspaceError,
  type AddWorkspaceMemberInput,
  type CreateProjectInput,
  type Workspace,
} from '@green-hive/projects';
import type { ReferenceAppServer } from './server.js';

export const REFERENCE_APP_COOKIE_NAMES = Object.freeze({
  access: 'green_hive_access',
  refresh: 'green_hive_refresh',
  recovery: 'green_hive_recovery',
  workspace: 'green_hive_workspace',
});

const MUTATING_METHODS = new Set(['POST', 'PUT', 'PATCH', 'DELETE']);
const AUTH_BODY_KEYS = new Set(['email', 'password']);
const RECOVERY_BODY_KEYS = new Set(['email']);
const RECOVERY_EXCHANGE_BODY_KEYS = new Set(['code', 'flowId']);
const RECOVERY_COMPLETION_BODY_KEYS = new Set(['newPassword']);
const PROFILE_BODY_KEYS = new Set([
  'displayName',
  'preferredLanguage',
  'preferredLocale',
  'timezone',
  'preferences',
]);
const PROJECT_BODY_KEYS = new Set(['name', 'metadata']);
const WORKSPACE_BODY_KEYS = new Set(['name']);
const WORKSPACE_SELECTION_BODY_KEYS = new Set(['organizationId']);
const WORKSPACE_MEMBER_BODY_KEYS = new Set(['userId', 'role']);

export type ReferenceAppHttpFacade = Pick<
  ReferenceAppServer,
  | 'signUp'
  | 'signIn'
  | 'refreshSession'
  | 'signOut'
  | 'requestPasswordRecovery'
  | 'exchangePasswordRecoveryCode'
  | 'completePasswordRecovery'
  | 'getMe'
  | 'updateMe'
  | 'listWorkspaces'
  | 'createSharedWorkspace'
  | 'listWorkspaceMembers'
  | 'addWorkspaceMember'
  | 'listAuditEvents'
  | 'createProject'
  | 'listProjects'
  | 'getProject'
  | 'archiveProject'
  | 'softDeleteProject'
>;

export interface ReferenceAppHttpServerOptions {
  readonly facade: ReferenceAppHttpFacade;
  readonly allowedOrigin: string;
  readonly secureCookies: boolean;
  readonly webRoot?: string;
  readonly logger?: boolean;
}

function exactObject(
  value: unknown,
  allowedKeys: ReadonlySet<string>,
  error: AuthError | ProjectError | WorkspaceError,
): Record<string, unknown> {
  if (
    typeof value !== 'object' ||
    value === null ||
    Array.isArray(value) ||
    Object.keys(value).some((key) => !allowedKeys.has(key))
  ) {
    throw error;
  }
  return value as Record<string, unknown>;
}

function cookieOptions(secure: boolean) {
  return {
    httpOnly: true,
    sameSite: 'lax' as const,
    secure,
    path: '/',
  };
}

function setSessionCookies(reply: FastifyReply, session: AuthSession, secure: boolean): void {
  const accessMaxAge = Math.max(60, Math.floor((session.expiresAt.getTime() - Date.now()) / 1000));
  reply.setCookie(REFERENCE_APP_COOKIE_NAMES.access, session.accessToken, {
    ...cookieOptions(secure),
    maxAge: accessMaxAge,
  });
  reply.setCookie(REFERENCE_APP_COOKIE_NAMES.refresh, session.refreshToken, {
    ...cookieOptions(secure),
    maxAge: 400 * 24 * 60 * 60,
  });
}

function clearSessionCookies(reply: FastifyReply, secure: boolean): void {
  const options = cookieOptions(secure);
  reply.clearCookie(REFERENCE_APP_COOKIE_NAMES.access, options);
  reply.clearCookie(REFERENCE_APP_COOKIE_NAMES.refresh, options);
  reply.clearCookie(REFERENCE_APP_COOKIE_NAMES.workspace, options);
}

function setWorkspaceCookie(reply: FastifyReply, organizationId: string, secure: boolean): void {
  reply.setCookie(REFERENCE_APP_COOKIE_NAMES.workspace, organizationId, {
    ...cookieOptions(secure),
    maxAge: 400 * 24 * 60 * 60,
  });
}

function preferredWorkspace(workspaces: readonly Workspace[], requestedId?: string): Workspace {
  const selected = workspaces.find((workspace) => workspace.id === requestedId)
    ?? workspaces.find((workspace) => workspace.kind === 'PERSONAL')
    ?? workspaces[0];
  if (!selected) throw new WorkspaceError('WORKSPACE_NOT_FOUND');
  return selected;
}

async function resolveWorkspace(
  token: string,
  request: FastifyRequest,
  reply: FastifyReply,
  facade: ReferenceAppHttpFacade,
  secureCookies: boolean,
): Promise<Workspace> {
  const workspaces = await facade.listWorkspaces(token);
  const requestedId = request.cookies[REFERENCE_APP_COOKIE_NAMES.workspace];
  const selected = preferredWorkspace(workspaces, requestedId);
  if (requestedId !== selected.id) setWorkspaceCookie(reply, selected.id, secureCookies);
  return selected;
}

function accessToken(request: FastifyRequest): string {
  const token = request.cookies[REFERENCE_APP_COOKIE_NAMES.access];
  if (!token) throw new AuthError('AUTH_SESSION_INVALID');
  return token;
}

function projectId(request: FastifyRequest): string {
  const params = request.params as { id?: unknown };
  if (typeof params.id !== 'string') throw new ProjectError('INVALID_PROJECT_INPUT');
  return params.id;
}

async function withSession<Result>(
  request: FastifyRequest,
  reply: FastifyReply,
  facade: ReferenceAppHttpFacade,
  secureCookies: boolean,
  operation: (token: string) => Promise<Result>,
): Promise<Result> {
  try {
    return await operation(accessToken(request));
  } catch (error) {
    const refreshToken = request.cookies[REFERENCE_APP_COOKIE_NAMES.refresh];
    if (!(error instanceof AuthError) || error.code !== 'AUTH_SESSION_INVALID' || !refreshToken) {
      throw error;
    }
    try {
      const session = await facade.refreshSession({ refreshToken });
      setSessionCookies(reply, session, secureCookies);
      return await operation(session.accessToken);
    } catch {
      clearSessionCookies(reply, secureCookies);
      throw new AuthError('AUTH_SESSION_INVALID');
    }
  }
}

function publicError(error: unknown): { status: number; code: string; message: string } {
  if (error instanceof AuthError) {
    const status =
      error.code === 'INVALID_AUTH_INPUT' || error.code === 'INVALID_ACCOUNT_INPUT'
        ? 400
        : error.code === 'AUTH_INVALID_CREDENTIALS' ||
            error.code === 'AUTH_SESSION_INVALID' ||
            error.code === 'AUTH_SESSION_REFRESH_FAILED' ||
            error.code === 'AUTH_RECOVERY_EXCHANGE_FAILED'
          ? 401
          : error.code === 'AUTH_APP_NOT_ALLOWED' || error.code === 'ACCOUNT_ACCESS_DENIED'
              || error.code === 'AUTH_ORGANIZATION_ACCESS_DENIED'
            ? 403
            : error.code === 'ACCOUNT_NOT_FOUND'
              ? 404
              : 503;
    return { status, code: error.code, message: error.message };
  }
  if (error instanceof ProjectError) {
    const status =
      error.code === 'PROJECT_NOT_FOUND'
        ? 404
        : error.code === 'PROJECT_ACCESS_DENIED'
          ? 403
          : error.code === 'INVALID_PROJECT_TRANSITION'
            ? 409
            : error.code === 'INVALID_PROJECT_INPUT'
              ? 400
              : 503;
    return { status, code: error.code, message: error.message };
  }
  if (error instanceof WorkspaceError) {
    const status =
      error.code === 'INVALID_WORKSPACE_INPUT'
        ? 400
        : error.code === 'WORKSPACE_ACCESS_DENIED'
          ? 403
          : error.code === 'WORKSPACE_NOT_FOUND'
            ? 404
            : 503;
    return { status, code: error.code, message: error.message };
  }
  if (error instanceof AuditError) {
    const status = error.code === 'AUDIT_INVALID_INPUT'
      ? 400
      : error.code === 'AUDIT_ACCESS_DENIED'
        ? 403
        : 503;
    return { status, code: error.code, message: error.message };
  }
  return { status: 500, code: 'INTERNAL_ERROR', message: 'Request could not be completed' };
}

export async function createReferenceAppHttpServer(
  options: ReferenceAppHttpServerOptions,
): Promise<FastifyInstance> {
  const allowedOrigin = new URL(options.allowedOrigin).origin;
  const application = Fastify({
    logger: options.logger ?? false,
    bodyLimit: 32 * 1024,
    trustProxy: false,
  });
  await application.register(cookie);

  application.addHook('onRequest', async (request, reply) => {
    reply.header('X-Content-Type-Options', 'nosniff');
    reply.header('X-Frame-Options', 'DENY');
    reply.header('Referrer-Policy', 'no-referrer');
    reply.header('Cross-Origin-Opener-Policy', 'same-origin');
    reply.header('Permissions-Policy', 'camera=(), microphone=(), geolocation=()');
    reply.header(
      'Content-Security-Policy',
      "default-src 'self'; script-src 'self'; style-src 'self'; img-src 'self' data:; connect-src 'self'; base-uri 'none'; frame-ancestors 'none'; form-action 'self'",
    );

    if (request.url.startsWith('/api/') || request.url.startsWith('/auth/')) {
      reply.header('Cache-Control', 'private, no-store');
      reply.header('Pragma', 'no-cache');
    }
    if (request.url.startsWith('/api/') && MUTATING_METHODS.has(request.method)) {
      if (request.headers.origin !== allowedOrigin) {
        throw new AuthError('INVALID_AUTH_INPUT');
      }
      if (!request.headers['content-type']?.toLowerCase().startsWith('application/json')) {
        throw new AuthError('INVALID_AUTH_INPUT');
      }
    }
  });

  application.get('/api/health', async () => ({ status: 'ok', app: 'REFERENCE_APP' }));

  application.post('/api/auth/sign-up', async (request, reply) => {
    const body = exactObject(request.body, AUTH_BODY_KEYS, new AuthError('INVALID_AUTH_INPUT'));
    const session = await options.facade.signUp({
      email: body.email as string,
      password: body.password as string,
    });
    setSessionCookies(reply, session, options.secureCookies);
    const workspace = preferredWorkspace(await options.facade.listWorkspaces(session.accessToken));
    setWorkspaceCookie(reply, workspace.id, options.secureCookies);
    return { user: session.user };
  });

  application.post('/api/auth/sign-in', async (request, reply) => {
    const body = exactObject(request.body, AUTH_BODY_KEYS, new AuthError('INVALID_AUTH_INPUT'));
    const session = await options.facade.signIn({
      email: body.email as string,
      password: body.password as string,
    });
    setSessionCookies(reply, session, options.secureCookies);
    const workspace = preferredWorkspace(await options.facade.listWorkspaces(session.accessToken));
    setWorkspaceCookie(reply, workspace.id, options.secureCookies);
    return { user: session.user };
  });

  application.post('/api/auth/refresh', async (request, reply) => {
    exactObject(request.body, new Set(), new AuthError('INVALID_AUTH_INPUT'));
    const refreshToken = request.cookies[REFERENCE_APP_COOKIE_NAMES.refresh];
    if (!refreshToken) throw new AuthError('AUTH_SESSION_INVALID');
    const session = await options.facade.refreshSession({ refreshToken });
    setSessionCookies(reply, session, options.secureCookies);
    return { user: session.user };
  });

  application.post('/api/auth/sign-out', async (request, reply) => {
    const body = exactObject(request.body, new Set(['scope']), new AuthError('INVALID_AUTH_INPUT'));
    const token = request.cookies[REFERENCE_APP_COOKIE_NAMES.access];
    try {
      if (token) {
        await options.facade.signOut({
          accessToken: token,
          ...(body.scope === undefined ? {} : { scope: body.scope as 'local' | 'global' }),
        });
      }
    } finally {
      clearSessionCookies(reply, options.secureCookies);
    }
    return reply.code(204).send();
  });

  application.post('/api/auth/recovery', async (request, reply) => {
    const body = exactObject(request.body, RECOVERY_BODY_KEYS, new AuthError('INVALID_AUTH_INPUT'));
    const challenge = await options.facade.requestPasswordRecovery({ email: body.email as string });
    reply.setCookie(REFERENCE_APP_COOKIE_NAMES.recovery, challenge.state, {
      ...cookieOptions(options.secureCookies),
      maxAge: 10 * 60,
    });
    return { accepted: true };
  });

  application.post('/api/auth/recovery/exchange', async (request, reply) => {
    const body = exactObject(
      request.body,
      RECOVERY_EXCHANGE_BODY_KEYS,
      new AuthError('INVALID_AUTH_INPUT'),
    );
    const state = request.cookies[REFERENCE_APP_COOKIE_NAMES.recovery];
    if (!state) throw new AuthError('AUTH_RECOVERY_EXCHANGE_FAILED');
    const session = await options.facade.exchangePasswordRecoveryCode({
      code: body.code as string,
      state,
      ...(body.flowId === undefined ? {} : { flowId: body.flowId as string }),
    });
    reply.clearCookie(REFERENCE_APP_COOKIE_NAMES.recovery, cookieOptions(options.secureCookies));
    setSessionCookies(reply, session, options.secureCookies);
    return { ready: true };
  });

  application.post('/api/auth/recovery/complete', async (request, reply) => {
    const body = exactObject(
      request.body,
      RECOVERY_COMPLETION_BODY_KEYS,
      new AuthError('INVALID_AUTH_INPUT'),
    );
    const currentAccessToken = accessToken(request);
    const refreshToken = request.cookies[REFERENCE_APP_COOKIE_NAMES.refresh];
    if (!refreshToken) throw new AuthError('AUTH_SESSION_INVALID');
    await options.facade.completePasswordRecovery({
      accessToken: currentAccessToken,
      refreshToken,
      newPassword: body.newPassword as string,
    });
    return { updated: true };
  });

  application.get('/api/me', async (request, reply) => ({
    profile: await withSession(
      request,
      reply,
      options.facade,
      options.secureCookies,
      (token) => options.facade.getMe(token),
    ),
  }));

  application.patch('/api/me', async (request, reply) => {
    const body = exactObject(
      request.body,
      PROFILE_BODY_KEYS,
      new AuthError('INVALID_ACCOUNT_INPUT'),
    );
    const profile = await withSession(
      request,
      reply,
      options.facade,
      options.secureCookies,
      (token) => options.facade.updateMe(token, body),
    );
    return { profile };
  });

  application.get('/api/workspaces', async (request, reply) => {
    return withSession(
      request,
      reply,
      options.facade,
      options.secureCookies,
      async (token) => {
        const workspaces = await options.facade.listWorkspaces(token);
        const activeWorkspace = preferredWorkspace(
          workspaces,
          request.cookies[REFERENCE_APP_COOKIE_NAMES.workspace],
        );
        setWorkspaceCookie(reply, activeWorkspace.id, options.secureCookies);
        return { workspaces, activeWorkspaceId: activeWorkspace.id };
      },
    );
  });

  application.post('/api/workspaces', async (request, reply) => {
    const body = exactObject(
      request.body,
      WORKSPACE_BODY_KEYS,
      new WorkspaceError('INVALID_WORKSPACE_INPUT'),
    );
    const workspace = await withSession(
      request,
      reply,
      options.facade,
      options.secureCookies,
      (token) => options.facade.createSharedWorkspace(token, { name: body.name as string }),
    );
    setWorkspaceCookie(reply, workspace.id, options.secureCookies);
    return reply.code(201).send({ workspace });
  });

  application.post('/api/workspaces/select', async (request, reply) => {
    const body = exactObject(
      request.body,
      WORKSPACE_SELECTION_BODY_KEYS,
      new WorkspaceError('INVALID_WORKSPACE_INPUT'),
    );
    const workspace = await withSession(
      request,
      reply,
      options.facade,
      options.secureCookies,
      async (token) => {
        const workspaces = await options.facade.listWorkspaces(token);
        const selected = workspaces.find((entry) => entry.id === body.organizationId);
        if (!selected) throw new WorkspaceError('WORKSPACE_ACCESS_DENIED');
        return selected;
      },
    );
    setWorkspaceCookie(reply, workspace.id, options.secureCookies);
    return { workspace };
  });

  application.get('/api/workspaces/members', async (request, reply) => ({
    members: await withSession(
      request,
      reply,
      options.facade,
      options.secureCookies,
      async (token) => {
        const workspace = await resolveWorkspace(
          token,
          request,
          reply,
          options.facade,
          options.secureCookies,
        );
        return options.facade.listWorkspaceMembers(token, workspace.id);
      },
    ),
  }));

  application.post('/api/workspaces/members', async (request, reply) => {
    const body = exactObject(
      request.body,
      WORKSPACE_MEMBER_BODY_KEYS,
      new WorkspaceError('INVALID_WORKSPACE_INPUT'),
    );
    const member = await withSession(
      request,
      reply,
      options.facade,
      options.secureCookies,
      async (token) => {
        const workspace = await resolveWorkspace(
          token,
          request,
          reply,
          options.facade,
          options.secureCookies,
        );
        return options.facade.addWorkspaceMember(
          token,
          workspace.id,
          body as unknown as AddWorkspaceMemberInput,
        );
      },
    );
    return reply.code(201).send({ member });
  });

  application.get('/api/projects', async (request, reply) => ({
    projects: await withSession(
      request,
      reply,
      options.facade,
      options.secureCookies,
      async (token) => {
        const workspace = await resolveWorkspace(
          token,
          request,
          reply,
          options.facade,
          options.secureCookies,
        );
        return options.facade.listProjects(token, workspace.id);
      },
    ),
  }));

  application.get('/api/audit', async (request, reply) => ({
    events: await withSession(
      request,
      reply,
      options.facade,
      options.secureCookies,
      async (token) => {
        const workspace = await resolveWorkspace(
          token,
          request,
          reply,
          options.facade,
          options.secureCookies,
        );
        return options.facade.listAuditEvents(token, workspace.id);
      },
    ),
  }));

  application.post('/api/projects', async (request, reply) => {
    const body = exactObject(
      request.body,
      PROJECT_BODY_KEYS,
      new ProjectError('INVALID_PROJECT_INPUT'),
    );
    const project = await withSession(
      request,
      reply,
      options.facade,
      options.secureCookies,
      async (token) => {
        const workspace = await resolveWorkspace(
          token,
          request,
          reply,
          options.facade,
          options.secureCookies,
        );
        return options.facade.createProject(
          token,
          workspace.id,
          body as unknown as CreateProjectInput,
        );
      },
    );
    return reply.code(201).send({ project });
  });

  application.get('/api/projects/:id', async (request, reply) => ({
    project: await withSession(
      request,
      reply,
      options.facade,
      options.secureCookies,
      async (token) => {
        const workspace = await resolveWorkspace(
          token,
          request,
          reply,
          options.facade,
          options.secureCookies,
        );
        return options.facade.getProject(token, workspace.id, projectId(request));
      },
    ),
  }));

  application.post('/api/projects/:id/archive', async (request, reply) => {
    exactObject(request.body, new Set(), new ProjectError('INVALID_PROJECT_INPUT'));
    const project = await withSession(
      request,
      reply,
      options.facade,
      options.secureCookies,
      async (token) => {
        const workspace = await resolveWorkspace(
          token,
          request,
          reply,
          options.facade,
          options.secureCookies,
        );
        return options.facade.archiveProject(token, workspace.id, projectId(request));
      },
    );
    return { project };
  });

  application.post('/api/projects/:id/delete', async (request, reply) => {
    exactObject(request.body, new Set(), new ProjectError('INVALID_PROJECT_INPUT'));
    await withSession(
      request,
      reply,
      options.facade,
      options.secureCookies,
      async (token) => {
        const workspace = await resolveWorkspace(
          token,
          request,
          reply,
          options.facade,
          options.secureCookies,
        );
        return options.facade.softDeleteProject(token, workspace.id, projectId(request));
      },
    );
    return reply.code(204).send();
  });

  application.setErrorHandler((error, _request, reply) => {
    const safe = publicError(error);
    void reply.code(safe.status).send({ error: { code: safe.code, message: safe.message } });
  });

  if (options.webRoot) {
    await application.register(fastifyStatic, {
      root: options.webRoot,
      prefix: '/',
      cacheControl: true,
      maxAge: '1h',
    });
    application.setNotFoundHandler((request, reply) => {
      if (request.method === 'GET' && !request.url.startsWith('/api/')) {
        reply.header('Cache-Control', 'private, no-store');
        return reply.type('text/html').sendFile('index.html');
      }
      return reply.code(404).send({ error: { code: 'NOT_FOUND', message: 'Route was not found' } });
    });
  }

  return application;
}
