import { createHash } from 'node:crypto';
import { BillingError } from './errors.js';
import type {
  BillingWebhookProcessingResult,
  BillingWebhookRepository,
  BillingWebhookVerifier,
  ProviderWebhookVerificationRequest,
} from './types.js';
import { validateVerifiedProviderWebhookEvent } from './validation.js';

const PROVIDER_CODE = /^[A-Z][A-Z0-9_]{1,63}$/;
const MAX_WEBHOOK_BYTES = 32 * 1024;
const MAX_SIGNATURE_LENGTH = 256;

export class BillingWebhookService {
  readonly #repository: BillingWebhookRepository;
  readonly #verifiers: ReadonlyMap<string, BillingWebhookVerifier>;

  constructor(
    repository: BillingWebhookRepository,
    verifiers: readonly BillingWebhookVerifier[],
  ) {
    this.#repository = repository;
    const configured = new Map<string, BillingWebhookVerifier>();
    for (const verifier of verifiers) {
      if (!PROVIDER_CODE.test(verifier.providerCode) || configured.has(verifier.providerCode)) {
        throw new BillingError('BILLING_WEBHOOK_PROCESSING_FAILED');
      }
      configured.set(verifier.providerCode, verifier);
    }
    if (configured.size === 0) throw new BillingError('BILLING_WEBHOOK_PROCESSING_FAILED');
    this.#verifiers = configured;
  }

  async process(
    providerCode: string,
    request: ProviderWebhookVerificationRequest,
  ): Promise<BillingWebhookProcessingResult> {
    if (!PROVIDER_CODE.test(providerCode)) {
      throw new BillingError('BILLING_WEBHOOK_PROVIDER_UNSUPPORTED');
    }
    if (
      !(request.rawBody instanceof Uint8Array) ||
      request.rawBody.byteLength === 0 ||
      request.rawBody.byteLength > MAX_WEBHOOK_BYTES ||
      typeof request.signature !== 'string' ||
      request.signature.length === 0 ||
      request.signature.length > MAX_SIGNATURE_LENGTH
    ) {
      throw new BillingError('INVALID_BILLING_WEBHOOK_INPUT');
    }
    const verifier = this.#verifiers.get(providerCode);
    if (!verifier) throw new BillingError('BILLING_WEBHOOK_PROVIDER_UNSUPPORTED');

    let event;
    try {
      event = validateVerifiedProviderWebhookEvent(await verifier.verify(request));
    } catch (error) {
      if (error instanceof BillingError) throw error;
      throw new BillingError('BILLING_WEBHOOK_PROCESSING_FAILED');
    }
    if (event.providerCode !== providerCode) {
      throw new BillingError('BILLING_WEBHOOK_PROCESSING_FAILED');
    }

    const payloadSha256 = createHash('sha256').update(request.rawBody).digest('hex');
    try {
      return await this.#repository.applyVerifiedEvent(event, payloadSha256);
    } catch (error) {
      if (error instanceof BillingError) throw error;
      throw new BillingError('BILLING_WEBHOOK_PROCESSING_FAILED');
    }
  }
}
