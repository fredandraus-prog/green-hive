import { createHash } from 'node:crypto';
import {
  DocumentRenderError,
  renderDocument,
  type WorkerRenderedFileService,
} from '@green-hive/files';
import { JobError, type WorkerIdentity, type WorkerLease } from '@green-hive/jobs';

export const REFERENCE_APP_RENDER_PROJECT_DOCUMENT = 'REFERENCE_APP_RENDER_PROJECT_DOCUMENT' as const;

export interface ReferenceDocumentRenderWorkerLifecycle {
  complete(
    identity: WorkerIdentity,
    input: { readonly jobId: string; readonly leaseToken: string; readonly outputHash: string; readonly outputReference: string },
  ): Promise<void>;
  fail(
    identity: WorkerIdentity,
    input: { readonly jobId: string; readonly leaseToken: string; readonly failureKind: 'TRANSIENT' | 'PERMANENT'; readonly safeErrorCode: string },
  ): Promise<'RETRYING' | 'FAILED'>;
}

export interface ReferenceDocumentRenderWorkerDependencies {
  readonly files: WorkerRenderedFileService;
  readonly lifecycle: ReferenceDocumentRenderWorkerLifecycle;
}

export interface ReferenceDocumentRenderResult {
  readonly status: 'COMPLETED' | 'RETRYING' | 'FAILED';
  readonly fileId?: string;
}

function requestFormat(value: string | null): 'TEXT' | 'PDF' {
  if (value === 'render:text') return 'TEXT';
  if (value === 'render:pdf') return 'PDF';
  throw new DocumentRenderError();
}

function outputHash(value: Uint8Array): string {
  return createHash('sha256').update(value).digest('hex');
}

function assertDependencies(value: ReferenceDocumentRenderWorkerDependencies): void {
  if (
    !value
    || typeof value.files?.store !== 'function'
    || typeof value.lifecycle?.complete !== 'function'
    || typeof value.lifecycle?.fail !== 'function'
  ) {
    throw new JobError('WORKER_INVALID_INPUT');
  }
}

/**
 * Processes one pre-claimed Reference App rendering job. Routing and job claiming stay outside this
 * class, so a worker never holds a lease for another app's job merely to inspect its payload.
 */
export class ReferenceDocumentRenderWorker {
  readonly #dependencies: ReferenceDocumentRenderWorkerDependencies;

  constructor(dependencies: ReferenceDocumentRenderWorkerDependencies) {
    assertDependencies(dependencies);
    this.#dependencies = dependencies;
  }

  async process(identity: WorkerIdentity, lease: WorkerLease): Promise<ReferenceDocumentRenderResult> {
    if (lease.jobType !== REFERENCE_APP_RENDER_PROJECT_DOCUMENT) {
      throw new JobError('WORKER_INVALID_INPUT');
    }
    try {
      const rendered = renderDocument({
        format: requestFormat(lease.inputReference),
        title: 'Green Hive Project Document',
        lines: Object.freeze([
          `Project: ${lease.projectId}`,
          'Artifact: private project document',
        ]),
      });
      const file = await this.#dependencies.files.store({
        jobId: lease.jobId,
        workerId: identity.workerId,
        leaseToken: lease.leaseToken,
      }, {
        originalFilename: `project-document.${rendered.extension}`,
        mediaType: rendered.mediaType,
        content: rendered.content,
        storageBucket: 'green-hive-generated',
      });
      await this.#dependencies.lifecycle.complete(identity, {
        jobId: lease.jobId,
        leaseToken: lease.leaseToken,
        outputHash: outputHash(rendered.content),
        outputReference: `file:${file.id}`,
      });
      return Object.freeze({ status: 'COMPLETED', fileId: file.id });
    } catch (error) {
      if (error instanceof JobError) throw error;
      const invalidRenderRequest = error instanceof DocumentRenderError;
      const status = await this.#dependencies.lifecycle.fail(identity, {
        jobId: lease.jobId,
        leaseToken: lease.leaseToken,
        failureKind: invalidRenderRequest ? 'PERMANENT' : 'TRANSIENT',
        safeErrorCode: invalidRenderRequest ? 'RENDER_REQUEST_INVALID' : 'RENDER_PRIVATE_STORAGE_FAILED',
      });
      return Object.freeze({ status });
    }
  }
}
