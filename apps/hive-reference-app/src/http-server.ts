import cookie from '@fastify/cookie';
import fastifyStatic from '@fastify/static';
import Fastify, {
  type FastifyInstance,
  type FastifyReply,
  type FastifyRequest,
} from 'fastify';
import { AuthError, type AuthSession } from '@green-hive/auth';
import { AuditError } from '@green-hive/audit';
import { NotificationError } from '@green-hive/notifications';
import { BillingError, type BillingWebhookService } from '@green-hive/billing';
import { EntitlementError, validateCapabilityCode } from '@green-hive/entitlements';
import { toPublicError } from '@green-hive/core';
import {
  ProjectError,
  WorkspaceError,
  type AddWorkspaceMemberInput,
  type CreateProjectInput,
  type Workspace,
} from '@green-hive/projects';
import type { ReferenceAppServer } from './server.js';
import {
  ReferenceAppRateLimiter,
  type ReferenceAppRateLimitOptions,
} from './security-rate-limit.js';

export const REFERENCE_APP_COOKIE_NAMES = Object.freeze({
  access: 'green_hive_access',
  refresh: 'green_hive_refresh',
  recovery: 'green_hive_recovery',
  workspace: 'green_hive_workspace',
});

const MUTATING_METHODS = new Set(['POST', 'PUT', 'PATCH', 'DELETE']);
const AUTH_BODY_KEYS = new Set(['email', 'password']);
const SIGN_UP_BODY_KEYS = new Set([
  'email',
  'password',
  'displayName',
  'preferredLanguage',
  'preferredLocale',
  'timezone',
  'organizationName',
]);
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
  | 'getAccount'
  | 'updateMe'
  | 'listWorkspaces'
  | 'createSharedWorkspace'
  | 'renameWorkspace'
  | 'listWorkspaceMembers'
  | 'addWorkspaceMember'
  | 'listAuditEvents'
  | 'listNotifications'
  | 'markNotificationRead'
  | 'createProject'
  | 'listProjects'
  | 'getProject'
  | 'archiveProject'
  | 'softDeleteProject'
  | 'canProjectCapability'
>;

export interface ReferenceAppHttpServerOptions {
  readonly facade: ReferenceAppHttpFacade;
  readonly allowedOrigin: string;
  readonly secureCookies: boolean;
  readonly readinessCheck?: () => Promise<void>;
  readonly webRoot?: string;
  readonly logger?: boolean;
  readonly rateLimit?: ReferenceAppRateLimitOptions;
  readonly billingWebhookService?: Pick<BillingWebhookService, 'process'>;
}

function isBillingWebhookRequest(method: string, url: string): boolean {
  return method === 'POST' && /^\/api\/webhooks\/payments\/[^/?]+(?:\?.*)?$/.test(url);
}

function exactObject(
  value: unknown,
  allowedKeys: ReadonlySet<string>,
  error: AuthError | ProjectError | WorkspaceError | NotificationError,
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

function capabilityCode(request: FastifyRequest): string {
  const params = request.params as { capabilityCode?: unknown };
  if (typeof params.capabilityCode !== 'string') {
    throw new EntitlementError('INVALID_ENTITLEMENT_INPUT');
  }
  return validateCapabilityCode(params.capabilityCode);
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

export async function createReferenceAppHttpServer(
  options: ReferenceAppHttpServerOptions,
): Promise<FastifyInstance> {
  const allowedOrigin = new URL(options.allowedOrigin).origin;
  const rateLimiter = new ReferenceAppRateLimiter(options.rateLimit);
  const rawJsonBodies = new WeakMap<FastifyRequest, Uint8Array>();
  const application = Fastify({
    logger: options.logger ?? false,
    bodyLimit: 32 * 1024,
    trustProxy: false,
  });
  application.removeContentTypeParser('application/json');
  application.addContentTypeParser(
    'application/json',
    { parseAs: 'buffer' },
    (request, body, done) => {
      const rawBody = Buffer.isBuffer(body) ? body : Buffer.from(body);
      rawJsonBodies.set(request, rawBody);
      try {
        done(null, JSON.parse(rawBody.toString('utf8')));
      } catch {
        done(
          isBillingWebhookRequest(request.method, request.url)
            ? new BillingError('INVALID_BILLING_WEBHOOK_INPUT')
            : new AuthError('INVALID_AUTH_INPUT'),
          undefined,
        );
      }
    },
  );
  await application.register(cookie);

  application.addHook('onRequest', async (request, reply) => {
    reply.header('X-Content-Type-Options', 'nosniff');
    reply.header('X-Frame-Options', 'DENY');
    reply.header('Referrer-Policy', 'no-referrer');
    reply.header('Cross-Origin-Opener-Policy', 'same-origin');
    reply.header('Cross-Origin-Resource-Policy', 'same-origin');
    reply.header('X-DNS-Prefetch-Control', 'off');
    reply.header('X-Permitted-Cross-Domain-Policies', 'none');
    reply.header('Permissions-Policy', 'camera=(), microphone=(), geolocation=()');
    if (options.secureCookies) {
      reply.header('Strict-Transport-Security', 'max-age=31536000; includeSubDomains');
    }
    reply.header(
      'Content-Security-Policy',
      "default-src 'self'; script-src 'self'; style-src 'self'; img-src 'self' data:; connect-src 'self'; object-src 'none'; base-uri 'none'; frame-ancestors 'none'; form-action 'self'",
    );

    if (request.url.startsWith('/api/') || request.url.startsWith('/auth/')) {
      reply.header('Cache-Control', 'private, no-store');
      reply.header('Pragma', 'no-cache');
    }
    if (request.url.startsWith('/api/') && MUTATING_METHODS.has(request.method)) {
      if (
        !isBillingWebhookRequest(request.method, request.url) &&
        request.headers.origin !== allowedOrigin
      ) {
        throw new AuthError('INVALID_AUTH_INPUT');
      }
      if (!request.headers['content-type']?.toLowerCase().startsWith('application/json')) {
        throw new AuthError('INVALID_AUTH_INPUT');
      }
    }
  });

  application.addHook('preHandler', async (request, reply) => {
    const decision = rateLimiter.check(request);
    if (!decision) return;
    reply.header('RateLimit-Limit', decision.limit);
    reply.header('RateLimit-Remaining', decision.remaining);
    reply.header('RateLimit-Reset', decision.resetSeconds);
    reply.header(
      'RateLimit-Policy',
      `${decision.limit};w=${decision.windowSeconds}`,
    );
    if (decision.allowed) return;
    reply.header('Retry-After', decision.resetSeconds);
    const safe = toPublicError({ code: 'RATE_LIMITED' });
    return reply.code(safe.status).send({ error: safe });
  });

  application.get('/api/health', async () => ({ status: 'ok', app: 'REFERENCE_APP' }));
  application.get('/api/ready', async (_request, reply) => {
    try {
      await options.readinessCheck?.();
      return { status: 'ready', app: 'REFERENCE_APP' };
    } catch {
      return reply.code(503).send({ status: 'not_ready', app: 'REFERENCE_APP' });
    }
  });

  application.post<{ Params: { provider: string } }>(
    '/api/webhooks/payments/:provider',
    async (request, reply) => {
      if (!options.billingWebhookService) {
        throw new BillingError('BILLING_WEBHOOK_PROCESSING_FAILED');
      }
      const signature = request.headers['x-green-hive-signature'];
      if (typeof signature !== 'string') {
        throw new BillingError('BILLING_WEBHOOK_SIGNATURE_INVALID');
      }
      const rawBody = rawJsonBodies.get(request);
      if (!rawBody) throw new BillingError('INVALID_BILLING_WEBHOOK_INPUT');
      const result = await options.billingWebhookService.process(request.params.provider, {
        signature,
        rawBody,
      });
      return reply.code(202).send({ status: 'accepted', duplicate: result.duplicate });
    },
  );

  application.post('/api/auth/sign-up', async (request, reply) => {
    const body = exactObject(request.body, SIGN_UP_BODY_KEYS, new AuthError('INVALID_AUTH_INPUT'));
    const session = await options.facade.signUp({
      email: body.email as string,
      password: body.password as string,
      ...(body.displayName === undefined ? {} : { displayName: body.displayName as string }),
      ...(body.preferredLanguage === undefined
        ? {}
        : { preferredLanguage: body.preferredLanguage as string }),
      ...(body.preferredLocale === undefined
        ? {}
        : { preferredLocale: body.preferredLocale as string }),
      ...(body.timezone === undefined ? {} : { timezone: body.timezone as string }),
      ...(body.organizationName === undefined
        ? {}
        : { organizationName: body.organizationName as string }),
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

  application.get('/api/me', async (request, reply) => withSession(
      request,
      reply,
      options.facade,
      options.secureCookies,
      (token) => options.facade.getAccount(token),
    ));

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

  application.patch('/api/workspaces/current', async (request, reply) => {
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
      async (token) => {
        const selected = await resolveWorkspace(
          token,
          request,
          reply,
          options.facade,
          options.secureCookies,
        );
        return options.facade.renameWorkspace(token, selected.id, { name: body.name as string });
      },
    );
    return { workspace };
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

  application.get('/api/notifications', async (request, reply) => ({
    notifications: await withSession(
      request,
      reply,
      options.facade,
      options.secureCookies,
      async (token) => {
        const workspace = await resolveWorkspace(
          token, request, reply, options.facade, options.secureCookies,
        );
        return options.facade.listNotifications(token, workspace.id);
      },
    ),
  }));

  application.post('/api/notifications/:id/read', async (request, reply) => {
    exactObject(request.body, new Set(), new NotificationError('NOTIFICATION_INVALID_INPUT'));
    const notification = await withSession(
      request,
      reply,
      options.facade,
      options.secureCookies,
      async (token) => {
        const workspace = await resolveWorkspace(
          token, request, reply, options.facade, options.secureCookies,
        );
        return options.facade.markNotificationRead(token, workspace.id, projectId(request));
      },
    );
    return { notification };
  });

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

  application.get(
    '/api/projects/:id/capabilities/:capabilityCode',
    async (request, reply) => ({
      allowed: await withSession(
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
          return options.facade.canProjectCapability(
            token,
            workspace.id,
            projectId(request),
            capabilityCode(request),
          );
        },
      ),
    }),
  );

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
    const safe = toPublicError(error);
    void reply.code(safe.status).send({ error: safe });
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
      const safe = toPublicError({ code: 'NOT_FOUND' });
      return reply.code(safe.status).send({ error: safe });
    });
  }

  return application;
}
