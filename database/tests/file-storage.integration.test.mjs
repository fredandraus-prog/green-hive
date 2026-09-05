import assert from 'node:assert/strict';
import { createHash, randomBytes } from 'node:crypto';
import test from 'node:test';
import { createClient } from '@supabase/supabase-js';
import {
  assertLocalSupabaseTarget,
  LOCAL_SUPABASE_CONFIRMATION,
  LOCAL_SUPABASE_TARGET,
} from '../../scripts/lib/local-supabase-guard.mjs';
import {
  stagingDatabaseConfigurationFromEnvironment,
  SUPABASE_STAGING_TARGET,
} from '../../scripts/lib/staging-guard.mjs';
import {
  FileService,
  SupabasePrivateStorageProvider,
} from '../../packages/files/dist/index.js';

const databaseUrl = process.env.GREEN_HIVE_TEST_DATABASE_URL;
const target = process.env.GREEN_HIVE_TEST_TARGET;
const confirmation = process.env.GREEN_HIVE_TEST_CONFIRM;
const authUrl = process.env.GREEN_HIVE_SUPABASE_AUTH_URL?.trim();
const serviceRoleKey = process.env.GREEN_HIVE_SUPABASE_SERVICE_ROLE_KEY?.trim();
const isStaging = target === SUPABASE_STAGING_TARGET;
const bucket = 'green-hive-generated';
const providerCode = 'GREEN_HIVE_SUPABASE_STORAGE';
const ownerId = '10000000-0000-4000-8000-000000000001';
const organizationId = '30000000-0000-4000-8000-000000000001';
const projectId = '20000000-0000-4000-8000-000000000161';
const fileId = '70000000-0000-4000-8000-000000000161';

function baseUrl(value) {
  if (!value) throw new Error('GREEN_HIVE_SUPABASE_AUTH_URL is required');
  const parsed = new URL(value);
  const suffix = '/auth/v1';
  if (!parsed.pathname.replace(/\/$/, '').endsWith(suffix)) {
    throw new Error('GREEN_HIVE_SUPABASE_AUTH_URL must end in /auth/v1');
  }
  parsed.pathname = parsed.pathname.replace(new RegExp(`${suffix}/?$`), '/');
  parsed.search = '';
  parsed.hash = '';
  return parsed;
}

function assertTarget() {
  if (!databaseUrl || !confirmation || !target) {
    throw new Error('The guarded Supabase target is required');
  }
  if (isStaging) {
    const staging = stagingDatabaseConfigurationFromEnvironment();
    assert.equal(staging.databaseUrl.toString(), new URL(databaseUrl).toString());
    assert.equal(process.env.GREEN_HIVE_TEST_PREPARED, 'SUPABASE_STAGING_BASELINE_READY');
  } else {
    assertLocalSupabaseTarget({ databaseUrl, target, confirmation });
  }
  if (!serviceRoleKey) throw new Error('GREEN_HIVE_SUPABASE_SERVICE_ROLE_KEY is required');
  const endpoint = baseUrl(authUrl);
  if (isStaging && endpoint.protocol !== 'https:') {
    throw new Error('Hosted Supabase Storage must use HTTPS');
  }
  if (!isStaging && endpoint.protocol !== 'http:') {
    throw new Error('Local Supabase Storage must use its local HTTP endpoint');
  }
  return endpoint;
}

test(
  'GH-0602 writes, signs, reads and removes one disposable private Storage object',
  { skip: !databaseUrl || !confirmation || !authUrl || !serviceRoleKey ? 'Supabase Storage gate not configured' : false },
  async () => {
    const endpoint = assertTarget();
    const storageKey = `ghf/${randomBytes(32).toString('hex')}`;
    const content = new TextEncoder().encode('green-hive signed private download probe');
    const contentSha256 = createHash('sha256').update(content).digest('hex');
    const client = createClient(endpoint.toString(), serviceRoleKey, {
      auth: { autoRefreshToken: false, persistSession: false },
    });
    const storage = new SupabasePrivateStorageProvider(client, {
      providerCode,
      privateBuckets: [bucket],
    });
    let stored = null;
    try {
      stored = await storage.putPrivate({
        storageProvider: providerCode,
        storageBucket: bucket,
        storageKey,
        mediaType: 'text/plain',
        byteSize: content.byteLength,
        contentSha256,
        content,
      });
      assert.equal((await storage.headPrivate({
        storageProvider: providerCode,
        storageBucket: bucket,
        storageKey,
      }))?.contentSha256, contentSha256);

      const publicRead = await fetch(new URL(`/storage/v1/object/public/${bucket}/${storageKey}`, endpoint));
      assert.equal(publicRead.ok, false);

      let exportRecorded = false;
      const service = new FileService({
        requiredCapability: 'REFERENCE_APP_GENERATE_FILE',
        sensitivity: 'INTERNAL',
        storageProvider: providerCode,
        storageBucket: bucket,
        maxBytes: 1024,
        allowedMediaTypes: ['text/plain'],
        downloadTtlSeconds: 120,
      }, {
        repository: {
          prepare: async () => { throw new Error('not used by download test'); },
          complete: async () => { throw new Error('not used by download test'); },
          abort: async () => {},
          list: async () => [],
          find: async () => ({
            id: fileId,
            organizationId,
            appId: '00000000-0000-4000-8000-000000000001',
            projectId,
            ownerUserId: ownerId,
            originalFilename: 'green-hive-check.txt',
            mediaType: 'text/plain',
            byteSize: content.byteLength,
            sensitivity: 'INTERNAL',
            status: 'READY',
            requiredCapability: 'REFERENCE_APP_GENERATE_FILE',
            storageProvider: providerCode,
            storageBucket: bucket,
            storageKey,
            contentSha256,
            idempotencyKeySha256: 'a'.repeat(64),
            requestFingerprintSha256: 'b'.repeat(64),
            objectVersion: stored.objectVersion,
            createdAt: new Date(),
            readyAt: new Date(),
            deletedAt: null,
            updatedAt: new Date(),
          }),
          softDelete: async () => false,
          recordExport: async () => { exportRecorded = true; },
        },
        storage,
        entitlements: { can: async () => true },
      });
      const grant = await service.createDownload({
        userId: ownerId,
        appCode: 'REFERENCE_APP',
        organizationId,
      }, projectId, fileId);
      assert.equal(exportRecorded, true);
      assert.equal(new URL(grant.url).protocol, isStaging ? 'https:' : 'http:');
      const signedRead = await fetch(grant.url);
      assert.equal(signedRead.ok, true);
      assert.deepEqual(new Uint8Array(await signedRead.arrayBuffer()), content);

      await storage.deletePrivate({
        storageProvider: providerCode,
        storageBucket: bucket,
        storageKey,
        objectVersion: stored.objectVersion,
      });
      stored = null;
      assert.equal(await storage.headPrivate({
        storageProvider: providerCode,
        storageBucket: bucket,
        storageKey,
      }), null);
    } finally {
      if (stored) {
        await storage.deletePrivate({
          storageProvider: providerCode,
          storageBucket: bucket,
          storageKey,
          objectVersion: stored.objectVersion,
        }).catch(() => undefined);
      }
    }
  },
);
