import type { TrustedAppContext } from '@green-hive/core';
import { AuthError } from './errors.js';
import type { AccountProfile, AccountProfileInput, AccountRepository } from './types.js';
import { validateAccountProfileInput } from './validation.js';

export class AccountService {
  readonly #repository: AccountRepository;

  constructor(repository: AccountRepository) {
    this.#repository = repository;
  }

  async ensure(
    context: TrustedAppContext,
    input: AccountProfileInput = {},
  ): Promise<AccountProfile> {
    this.#assertOwnerWrite(context);
    const validated = validateAccountProfileInput(input, { allowEmpty: true });
    return this.#execute(() => this.#repository.ensure(context, validated));
  }

  async get(context: TrustedAppContext): Promise<AccountProfile> {
    const profile = await this.#execute(() => this.#repository.get(context));
    if (!profile) throw new AuthError('ACCOUNT_NOT_FOUND');
    return profile;
  }

  async update(
    context: TrustedAppContext,
    input: AccountProfileInput,
  ): Promise<AccountProfile> {
    this.#assertOwnerWrite(context);
    const validated = validateAccountProfileInput(input, { allowEmpty: false });
    const profile = await this.#execute(() => this.#repository.update(context, validated));
    if (!profile) throw new AuthError('ACCOUNT_NOT_FOUND');
    return profile;
  }

  #assertOwnerWrite(context: TrustedAppContext): void {
    if (context.platformRole === 'PLATFORM_ADMIN') {
      throw new AuthError('ACCOUNT_ACCESS_DENIED');
    }
  }

  async #execute<Result>(operation: () => Promise<Result>): Promise<Result> {
    try {
      return await operation();
    } catch (error) {
      if (error instanceof AuthError) throw error;
      throw new AuthError('ACCOUNT_OPERATION_FAILED');
    }
  }
}
