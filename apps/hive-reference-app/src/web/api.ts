import type { PlatformErrorCategory } from '@green-hive/core';
import { clientErrorMessage, platformErrorCategory } from '../frontend-contracts.js';

interface ApiErrorPayload {
  readonly error?: {
    readonly code?: string;
    readonly category?: string;
    readonly retryable?: boolean;
  };
}

export class ApiFailure extends Error {
  readonly code: string;
  readonly status: number;
  readonly category: PlatformErrorCategory;
  readonly retryable: boolean;

  constructor(status: number, code: string, category: PlatformErrorCategory, retryable: boolean) {
    super(clientErrorMessage(code, category));
    this.name = 'ApiFailure';
    this.status = status;
    this.code = code;
    this.category = category;
    this.retryable = retryable;
  }
}

export async function api<Result>(path: string, options: RequestInit = {}): Promise<Result> {
  const response = await fetch(path, {
    ...options,
    credentials: 'include',
    headers: {
      ...(options.body === undefined ? {} : { 'Content-Type': 'application/json' }),
      ...options.headers,
    },
  });
  if (!response.ok) {
    const payload = (await response.json().catch(() => ({}))) as ApiErrorPayload;
    const category = platformErrorCategory(payload.error?.category);
    throw new ApiFailure(
      response.status,
      payload.error?.code ?? 'INTERNAL_ERROR',
      category,
      payload.error?.retryable === true,
    );
  }
  if (response.status === 204) return undefined as Result;
  return response.json() as Promise<Result>;
}
