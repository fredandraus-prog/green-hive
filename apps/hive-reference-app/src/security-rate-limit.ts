import { createHmac, randomBytes } from 'node:crypto';
import { isIP } from 'node:net';
import type { FastifyRequest } from 'fastify';

const MINUTE = 60 * 1000;

export const REFERENCE_APP_RATE_LIMIT_POLICIES = Object.freeze({
  AUTH_SIGN_UP: Object.freeze({ limit: 5, windowMs: 15 * MINUTE }),
  AUTH_SIGN_IN: Object.freeze({ limit: 10, windowMs: 15 * MINUTE }),
  AUTH_RECOVERY_REQUEST: Object.freeze({ limit: 3, windowMs: 60 * MINUTE }),
  AUTH_RECOVERY_EXCHANGE: Object.freeze({ limit: 10, windowMs: 15 * MINUTE }),
  AUTH_RECOVERY_COMPLETE: Object.freeze({ limit: 5, windowMs: 15 * MINUTE }),
  AUTH_SESSION: Object.freeze({ limit: 30, windowMs: 15 * MINUTE }),
  BILLING_WEBHOOK: Object.freeze({ limit: 60, windowMs: MINUTE }),
  API_STANDARD: Object.freeze({ limit: 120, windowMs: MINUTE }),
  API_EXPENSIVE: Object.freeze({ limit: 30, windowMs: MINUTE }),
});

export type ReferenceAppRateLimitPolicyName = keyof typeof REFERENCE_APP_RATE_LIMIT_POLICIES;

export interface ReferenceAppRateLimitRule {
  readonly limit: number;
  readonly windowMs: number;
}

export interface ReferenceAppRateLimitOptions {
  readonly maxBuckets?: number;
  readonly now?: () => number;
  readonly policies?: Partial<Record<ReferenceAppRateLimitPolicyName, ReferenceAppRateLimitRule>>;
  readonly secret?: Uint8Array;
}

export interface ReferenceAppRateLimitDecision {
  readonly allowed: boolean;
  readonly limit: number;
  readonly remaining: number;
  readonly resetSeconds: number;
  readonly windowSeconds: number;
  readonly policy: ReferenceAppRateLimitPolicyName;
}

interface Bucket {
  count: number;
  resetAt: number;
}

interface RequestPolicy {
  readonly name: ReferenceAppRateLimitPolicyName;
  readonly principal: string;
  readonly source: string;
}

const DEFAULT_MAX_BUCKETS = 10_000;
const SOURCE_LIMIT_MULTIPLIER = 10;
const GLOBAL_LIMIT_MULTIPLIER = 100;
const ROUTE_POLICIES = new Map<string, ReferenceAppRateLimitPolicyName>([
  ['POST /api/auth/sign-up', 'AUTH_SIGN_UP'],
  ['POST /api/auth/sign-in', 'AUTH_SIGN_IN'],
  ['POST /api/auth/recovery', 'AUTH_RECOVERY_REQUEST'],
  ['POST /api/auth/recovery/exchange', 'AUTH_RECOVERY_EXCHANGE'],
  ['POST /api/auth/recovery/complete', 'AUTH_RECOVERY_COMPLETE'],
  ['POST /api/auth/refresh', 'AUTH_SESSION'],
  ['POST /api/auth/sign-out', 'AUTH_SESSION'],
  ['POST /api/webhooks/payments/:provider', 'BILLING_WEBHOOK'],
  ['GET /api/audit', 'API_EXPENSIVE'],
  ['GET /api/workspaces/members', 'API_EXPENSIVE'],
]);

function positiveInteger(value: number, name: string): number {
  if (!Number.isSafeInteger(value) || value <= 0) {
    throw new Error(`${name} must be a positive safe integer`);
  }
  return value;
}

function normalizedEmail(request: FastifyRequest): string | undefined {
  const body = request.body;
  if (typeof body !== 'object' || body === null || Array.isArray(body)) return undefined;
  const email = (body as Record<string, unknown>).email;
  if (typeof email !== 'string') return undefined;
  const normalized = email.trim().toLowerCase();
  return normalized || undefined;
}

function firstForwardedIp(request: FastifyRequest): string | undefined {
  const forwarded = request.headers['x-forwarded-for'];
  const value = Array.isArray(forwarded) ? forwarded[0] : forwarded;
  if (typeof value !== 'string') return undefined;
  const first = value.split(',', 1)[0]?.trim();
  return first && isIP(first) !== 0 ? first : undefined;
}

function sourcePrincipal(request: FastifyRequest): string {
  return `source:${firstForwardedIp(request) ?? request.ip}`;
}

function cookiePrincipal(request: FastifyRequest, name: string): string | undefined {
  const value = request.cookies[name];
  return value ? `cookie:${value}` : undefined;
}

function requestPolicy(request: FastifyRequest): RequestPolicy | undefined {
  const route = request.routeOptions.url;
  if (!route || !route.startsWith('/api/') || route === '/api/health' || route === '/api/ready') {
    return undefined;
  }
  const name = ROUTE_POLICIES.get(`${request.method} ${route}`) ?? 'API_STANDARD';
  const source = sourcePrincipal(request);
  if (name === 'AUTH_SIGN_UP' || name === 'AUTH_SIGN_IN' || name === 'AUTH_RECOVERY_REQUEST') {
    return {
      name,
      principal: normalizedEmail(request) ? `email:${normalizedEmail(request)}` : source,
      source,
    };
  }
  if (name === 'AUTH_RECOVERY_EXCHANGE') {
    return {
      name,
      principal: cookiePrincipal(request, 'green_hive_recovery') ?? source,
      source,
    };
  }
  if (name === 'AUTH_RECOVERY_COMPLETE') {
    return {
      name,
      principal: cookiePrincipal(request, 'green_hive_access') ?? source,
      source,
    };
  }
  if (name === 'AUTH_SESSION') {
    return {
      name,
      principal:
        cookiePrincipal(request, 'green_hive_access')
        ?? cookiePrincipal(request, 'green_hive_refresh')
        ?? source,
      source,
    };
  }
  return {
    name,
    principal: cookiePrincipal(request, 'green_hive_access') ?? source,
    source,
  };
}

export class ReferenceAppRateLimiter {
  readonly #buckets = new Map<string, Bucket>();
  readonly #maxBuckets: number;
  readonly #now: () => number;
  readonly #policies: Record<ReferenceAppRateLimitPolicyName, ReferenceAppRateLimitRule>;
  readonly #secret: Uint8Array;

  constructor(options: ReferenceAppRateLimitOptions = {}) {
    this.#maxBuckets = positiveInteger(options.maxBuckets ?? DEFAULT_MAX_BUCKETS, 'maxBuckets');
    this.#now = options.now ?? Date.now;
    this.#secret = options.secret ?? randomBytes(32);
    if (this.#secret.byteLength < 32) throw new Error('rate-limit secret must contain at least 32 bytes');
    this.#policies = Object.fromEntries(
      Object.entries(REFERENCE_APP_RATE_LIMIT_POLICIES).map(([name, defaults]) => {
        const override = options.policies?.[name as ReferenceAppRateLimitPolicyName];
        return [name, Object.freeze({
          limit: positiveInteger(override?.limit ?? defaults.limit, `${name}.limit`),
          windowMs: positiveInteger(override?.windowMs ?? defaults.windowMs, `${name}.windowMs`),
        })];
      }),
    ) as Record<ReferenceAppRateLimitPolicyName, ReferenceAppRateLimitRule>;
  }

  get bucketCount(): number {
    return this.#buckets.size;
  }

  check(request: FastifyRequest): ReferenceAppRateLimitDecision | undefined {
    const selected = requestPolicy(request);
    if (!selected) return undefined;
    const rule = this.#policies[selected.name];
    const globalLimit = positiveInteger(
      rule.limit * GLOBAL_LIMIT_MULTIPLIER,
      `${selected.name}.globalLimit`,
    );
    const global = this.#consume(
      `global:${selected.name}`,
      globalLimit,
      rule.windowMs,
      selected.name,
    );
    if (!global.allowed) return global;
    const sourceLimit = positiveInteger(
      rule.limit * SOURCE_LIMIT_MULTIPLIER,
      `${selected.name}.sourceLimit`,
    );
    const source = this.#consume(
      `source:${selected.name}:${this.#digest(selected.source)}`,
      sourceLimit,
      rule.windowMs,
      selected.name,
    );
    if (!source.allowed || selected.principal === selected.source) return source;
    return this.#consume(
      `principal:${selected.name}:${this.#digest(selected.principal)}`,
      rule.limit,
      rule.windowMs,
      selected.name,
    );
  }

  #consume(
    key: string,
    limit: number,
    windowMs: number,
    policy: ReferenceAppRateLimitPolicyName,
  ): ReferenceAppRateLimitDecision {
    const now = this.#now();
    const windowSeconds = Math.max(1, Math.ceil(windowMs / 1000));
    let bucket = this.#buckets.get(key);
    if (bucket && now >= bucket.resetAt) {
      this.#buckets.delete(key);
      bucket = undefined;
    }
    if (!bucket) {
      this.#prune(now);
      if (this.#buckets.size >= this.#maxBuckets) {
        return {
          allowed: false,
          limit,
          remaining: 0,
          resetSeconds: 1,
          windowSeconds,
          policy,
        };
      }
      bucket = { count: 0, resetAt: now + windowMs };
      this.#buckets.set(key, bucket);
    }
    const resetSeconds = Math.max(1, Math.ceil((bucket.resetAt - now) / 1000));
    if (bucket.count >= limit) {
      return { allowed: false, limit, remaining: 0, resetSeconds, windowSeconds, policy };
    }
    bucket.count += 1;
    return {
      allowed: true,
      limit,
      remaining: Math.max(0, limit - bucket.count),
      resetSeconds,
      windowSeconds,
      policy,
    };
  }

  #digest(value: string): string {
    return createHmac('sha256', this.#secret).update(value).digest('hex');
  }

  #prune(now: number): void {
    for (const [key, bucket] of this.#buckets) {
      if (now >= bucket.resetAt) this.#buckets.delete(key);
    }
  }
}
