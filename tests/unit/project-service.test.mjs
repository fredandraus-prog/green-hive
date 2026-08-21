import assert from 'node:assert/strict';
import test from 'node:test';
import {
  PROJECT_ERROR_CODES,
  ProjectError,
  ProjectService,
} from '../../packages/projects/dist/index.js';

const USER_A_ID = '10000000-0000-4000-8000-000000000001';
const USER_B_ID = '10000000-0000-4000-8000-000000000002';
const REFERENCE_APP_ID = '00000000-0000-4000-8000-000000000001';
const OTHER_APP_ID = '00000000-0000-4000-8000-000000000002';
const ORGANIZATION_A_ID = '30000000-0000-4000-8000-000000000001';
const ORGANIZATION_B_ID = '30000000-0000-4000-8000-000000000002';
const PROJECT_ID_PREFIX = '20000000-0000-4000-8000-';
const appIds = new Map([
  ['REFERENCE_APP', REFERENCE_APP_ID],
  ['OTHER_TEST_APP', OTHER_APP_ID],
]);

function cloneProject(project) {
  return {
    ...project,
    metadata: structuredClone(project.metadata),
    archivedAt: project.archivedAt ? new Date(project.archivedAt) : null,
    deletedAt: project.deletedAt ? new Date(project.deletedAt) : null,
    createdAt: new Date(project.createdAt),
    updatedAt: new Date(project.updatedAt),
  };
}

class FakeProjectRepository {
  projects = new Map();
  nextId = 1;

  async create(context, input) {
    const now = new Date(`2026-08-18T21:00:0${this.nextId}.000Z`);
    const project = {
      id: `${PROJECT_ID_PREFIX}${String(this.nextId).padStart(12, '0')}`,
      organizationId: context.organizationId,
      appId: appIds.get(context.appCode),
      ownerUserId: context.userId,
      name: input.name,
      status: 'DRAFT',
      metadata: structuredClone(input.metadata),
      archivedAt: null,
      deletedAt: null,
      createdAt: now,
      updatedAt: now,
    };
    this.nextId += 1;
    this.projects.set(project.id, project);
    return cloneProject(project);
  }

  async list(context) {
    return [...this.projects.values()]
      .filter(
        (project) =>
          project.ownerUserId === context.userId &&
          project.organizationId === context.organizationId &&
          project.appId === appIds.get(context.appCode) &&
          project.status !== 'DELETED',
      )
      .map(cloneProject);
  }

  async get(context, projectId) {
    const project = this.projects.get(projectId);
    if (
      !project ||
      project.ownerUserId !== context.userId ||
      project.organizationId !== context.organizationId ||
      project.appId !== appIds.get(context.appCode) ||
      project.status === 'DELETED'
    ) {
      return null;
    }
    return cloneProject(project);
  }

  async archive(context, projectId) {
    const project = await this.get(context, projectId);
    if (!project) return null;
    if (project.status !== 'ARCHIVED') {
      project.status = 'ARCHIVED';
      project.archivedAt = new Date('2026-08-18T22:00:00.000Z');
      project.updatedAt = new Date('2026-08-18T22:00:00.000Z');
      this.projects.set(project.id, cloneProject(project));
    }
    return cloneProject(project);
  }

  async softDelete(context, projectId) {
    const project = await this.get(context, projectId);
    if (!project) return false;
    project.status = 'DELETED';
    project.deletedAt = new Date('2026-08-18T23:00:00.000Z');
    project.updatedAt = new Date('2026-08-18T23:00:00.000Z');
    this.projects.set(project.id, cloneProject(project));
    return true;
  }
}

const contextA = {
  userId: USER_A_ID,
  appCode: 'REFERENCE_APP',
  organizationId: ORGANIZATION_A_ID,
};
const contextB = {
  userId: USER_B_ID,
  appCode: 'REFERENCE_APP',
  organizationId: ORGANIZATION_B_ID,
};
const contextAOtherApp = {
  userId: USER_A_ID,
  appCode: 'OTHER_TEST_APP',
  organizationId: ORGANIZATION_A_ID,
};
const contextAOtherOrganization = {
  userId: USER_A_ID,
  appCode: 'REFERENCE_APP',
  organizationId: ORGANIZATION_B_ID,
};

function hasCode(code) {
  return (error) => error instanceof ProjectError && error.code === code;
}

test('Project Service creates, lists and gets only the trusted owner/app scope', async () => {
  const repository = new FakeProjectRepository();
  const service = new ProjectService(repository);
  const projectA = await service.create(contextA, { name: '  Project A  ', metadata: { tier: 1 } });
  await service.create(contextB, { name: 'Project B' });
  await service.create(contextAOtherApp, { name: 'Project A other app' });
  await service.create(contextAOtherOrganization, { name: 'Project A other organization' });

  assert.equal(projectA.name, 'Project A');
  assert.equal(projectA.ownerUserId, USER_A_ID);
  assert.equal(projectA.organizationId, ORGANIZATION_A_ID);
  assert.equal(projectA.appId, REFERENCE_APP_ID);
  assert.equal(projectA.status, 'DRAFT');
  assert.deepEqual((await service.list(contextA)).map((project) => project.id), [projectA.id]);
  assert.equal((await service.get(contextA, projectA.id)).id, projectA.id);
  await assert.rejects(service.get(contextB, projectA.id), hasCode('PROJECT_NOT_FOUND'));
  await assert.rejects(service.get(contextAOtherApp, projectA.id), hasCode('PROJECT_NOT_FOUND'));
  await assert.rejects(
    service.get(contextAOtherOrganization, projectA.id),
    hasCode('PROJECT_NOT_FOUND'),
  );
});

test('payload ownership/app identifiers and invalid runtime data are rejected', async () => {
  const service = new ProjectService(new FakeProjectRepository());
  await assert.rejects(
    service.create(contextA, { name: 'Forged', owner_user_id: USER_B_ID }),
    hasCode('INVALID_PROJECT_INPUT'),
  );
  await assert.rejects(
    service.create(contextA, { name: 'Forged', app_id: OTHER_APP_ID }),
    hasCode('INVALID_PROJECT_INPUT'),
  );
  await assert.rejects(
    service.create(contextA, { name: 'Forged', organization_id: ORGANIZATION_B_ID }),
    hasCode('INVALID_PROJECT_INPUT'),
  );
  await assert.rejects(service.create(contextA, { name: ' '.repeat(3) }), hasCode('INVALID_PROJECT_INPUT'));
  await assert.rejects(service.get(contextA, 'not-a-uuid'), hasCode('INVALID_PROJECT_INPUT'));
  await assert.rejects(
    service.list({ ...contextA, source: 'free-header' }),
    hasCode('PROJECT_ACCESS_DENIED'),
  );
});

test('archive and soft delete are idempotent and deleted projects cannot be mutated', async () => {
  const service = new ProjectService(new FakeProjectRepository());
  const created = await service.create(contextA, { name: 'Lifecycle' });
  const archived = await service.archive(contextA, created.id);
  const archivedAgain = await service.archive(contextA, created.id);
  assert.equal(archived.status, 'ARCHIVED');
  assert.equal(archived.archivedAt?.toISOString(), archivedAgain.archivedAt?.toISOString());
  assert.equal(archived.updatedAt.toISOString(), archivedAgain.updatedAt.toISOString());

  await service.softDelete(contextA, created.id);
  await service.softDelete(contextA, created.id);
  assert.deepEqual(await service.list(contextA), []);
  await assert.rejects(service.get(contextA, created.id), hasCode('PROJECT_NOT_FOUND'));
  await assert.rejects(service.archive(contextA, created.id), hasCode('PROJECT_NOT_FOUND'));
});

test('platform administrators cannot reuse private project commands', async () => {
  const service = new ProjectService(new FakeProjectRepository());
  const adminContext = { ...contextA, platformRole: 'PLATFORM_ADMIN' };
  await assert.rejects(service.create(adminContext, { name: 'Admin write' }), hasCode('PROJECT_ACCESS_DENIED'));
  await assert.rejects(service.list(adminContext), hasCode('PROJECT_ACCESS_DENIED'));
  await assert.rejects(
    service.get(adminContext, `${PROJECT_ID_PREFIX}000000000001`),
    hasCode('PROJECT_ACCESS_DENIED'),
  );
  await assert.rejects(
    service.archive(adminContext, `${PROJECT_ID_PREFIX}000000000001`),
    hasCode('PROJECT_ACCESS_DENIED'),
  );
  await assert.rejects(
    service.softDelete(adminContext, `${PROJECT_ID_PREFIX}000000000001`),
    hasCode('PROJECT_ACCESS_DENIED'),
  );
});

test('storage failures become stable public errors without SQL or internal details', async () => {
  const repository = {
    async create() {
      throw new Error('SQLSTATE 23505 secret_table internal stack');
    },
    async list() {
      return [];
    },
    async get() {
      return null;
    },
    async archive() {
      return null;
    },
    async softDelete() {
      return false;
    },
  };
  const service = new ProjectService(repository);
  await assert.rejects(service.create(contextA, { name: 'Safe error' }), (error) => {
    assert.ok(error instanceof ProjectError);
    assert.equal(error.code, 'PROJECT_OPERATION_FAILED');
    assert.equal(error.message, 'Project operation could not be completed');
    assert.doesNotMatch(error.message, /SQLSTATE|secret_table|stack/i);
    assert.equal('cause' in error, false);
    return true;
  });
  assert.ok(PROJECT_ERROR_CODES.includes('INVALID_PROJECT_TRANSITION'));
});
