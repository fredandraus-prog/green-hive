import assert from 'node:assert/strict';
import test from 'node:test';
import {
  WorkspaceError,
  WorkspaceService,
} from '../../packages/projects/dist/index.js';

const USER_A_ID = '10000000-0000-4000-8000-000000000001';
const USER_B_ID = '10000000-0000-4000-8000-000000000002';
const PERSONAL_ID = '30000000-0000-4000-8000-000000000001';
const SHARED_ID = '30000000-0000-4000-8000-000000000003';
const NOW = new Date('2026-08-20T00:00:00.000Z');

function workspace(id, name, kind, role) {
  return {
    id,
    name,
    slug: `${kind.toLowerCase()}-${id.replaceAll('-', '')}`,
    kind,
    status: 'ACTIVE',
    role,
    appRelationship: 'NATIVE',
    createdAt: NOW,
    updatedAt: NOW,
  };
}

class FakeWorkspaceRepository {
  workspaces = [workspace(PERSONAL_ID, 'Personal Workspace', 'PERSONAL', 'OWNER')];
  members = new Map([
    [`${PERSONAL_ID}:${USER_A_ID}`, {
      organizationId: PERSONAL_ID,
      userId: USER_A_ID,
      role: 'OWNER',
      status: 'ACTIVE',
      joinedAt: NOW,
      updatedAt: NOW,
    }],
  ]);

  async ensurePersonal(_context, name) {
    if (this.workspaces[0].name === 'Personal Workspace') {
      this.workspaces[0] = { ...this.workspaces[0], name };
    }
    return this.workspaces[0];
  }

  async list() {
    return this.workspaces;
  }

  async createShared(_context, name) {
    const created = workspace(SHARED_ID, name, 'SHARED', 'OWNER');
    this.workspaces.push(created);
    this.members.set(`${SHARED_ID}:${USER_A_ID}`, {
      organizationId: SHARED_ID,
      userId: USER_A_ID,
      role: 'OWNER',
      status: 'ACTIVE',
      joinedAt: NOW,
      updatedAt: NOW,
    });
    return created;
  }

  async rename(context, name) {
    const current = this.workspaces.find((entry) => entry.id === context.organizationId);
    if (!current || current.kind !== 'SHARED') throw new WorkspaceError('WORKSPACE_ACCESS_DENIED');
    const renamed = { ...current, name };
    this.workspaces = this.workspaces.map((entry) => entry.id === current.id ? renamed : entry);
    return renamed;
  }

  async listMembers(context) {
    return [...this.members.values()].filter(
      (member) => member.organizationId === context.organizationId,
    );
  }

  async addMember(context, input) {
    const added = {
      organizationId: context.organizationId,
      userId: input.userId,
      role: input.role,
      status: 'ACTIVE',
      joinedAt: NOW,
      updatedAt: NOW,
    };
    this.members.set(`${context.organizationId}:${input.userId}`, added);
    return added;
  }
}

const baseContext = { userId: USER_A_ID, appCode: 'REFERENCE_APP' };
const sharedContext = { ...baseContext, organizationId: SHARED_ID };

function hasWorkspaceCode(code) {
  return (error) => error instanceof WorkspaceError && error.code === code;
}

test('personal workspace is idempotent and shared workspace is separately listed', async () => {
  const service = new WorkspaceService(new FakeWorkspaceRepository());
  const personal = await service.ensurePersonal(baseContext);
  const personalAgain = await service.ensurePersonal(baseContext);
  assert.equal(personal.id, PERSONAL_ID);
  assert.equal(personalAgain.id, PERSONAL_ID);

  const shared = await service.createShared(baseContext, { name: '  BeeGreen Team  ' });
  assert.equal(shared.id, SHARED_ID);
  assert.equal(shared.name, 'BeeGreen Team');
  assert.deepEqual((await service.list(baseContext)).map((entry) => entry.id), [PERSONAL_ID, SHARED_ID]);
});

test('personal workspace accepts its initial organization name and shared workspace can be renamed', async () => {
  const service = new WorkspaceService(new FakeWorkspaceRepository());
  const personal = await service.ensurePersonal(baseContext, '  Minha Empresa  ');
  assert.equal(personal.name, 'Minha Empresa');
  await service.createShared(baseContext, { name: 'Equipe antiga' });
  const renamed = await service.rename(sharedContext, { name: '  Equipe Green  ' });
  assert.equal(renamed.name, 'Equipe Green');
});

test('workspace membership accepts only bounded non-owner roles in selected context', async () => {
  const service = new WorkspaceService(new FakeWorkspaceRepository());
  await service.createShared(baseContext, { name: 'Team' });
  const member = await service.addMember(sharedContext, { userId: USER_B_ID, role: 'ANALYST' });
  assert.equal(member.organizationId, SHARED_ID);
  assert.equal(member.role, 'ANALYST');
  assert.equal((await service.listMembers(sharedContext)).length, 2);

  await assert.rejects(
    service.addMember(sharedContext, { userId: USER_B_ID, role: 'OWNER' }),
    hasWorkspaceCode('INVALID_WORKSPACE_INPUT'),
  );
  await assert.rejects(
    service.addMember({ ...sharedContext, source: 'free-header' }, { userId: USER_B_ID, role: 'VIEWER' }),
    hasWorkspaceCode('WORKSPACE_ACCESS_DENIED'),
  );
});

test('platform administrator cannot enter member or owner workspace commands', async () => {
  const service = new WorkspaceService(new FakeWorkspaceRepository());
  const admin = { ...baseContext, platformRole: 'PLATFORM_ADMIN' };
  await assert.rejects(service.list(admin), hasWorkspaceCode('WORKSPACE_ACCESS_DENIED'));
  await assert.rejects(
    service.createShared(admin, { name: 'Admin workspace' }),
    hasWorkspaceCode('WORKSPACE_ACCESS_DENIED'),
  );
});

test('workspace storage failures are converted to stable safe errors', async () => {
  const service = new WorkspaceService({
    async ensurePersonal() { throw new Error('SQL secret'); },
    async list() { return []; },
    async createShared() { throw new Error('SQL secret'); },
    async rename() { throw new Error('SQL secret'); },
    async listMembers() { return []; },
    async addMember() { throw new Error('SQL secret'); },
  });
  await assert.rejects(service.ensurePersonal(baseContext), (error) => {
    assert.ok(error instanceof WorkspaceError);
    assert.equal(error.code, 'WORKSPACE_OPERATION_FAILED');
    assert.doesNotMatch(error.message, /SQL|secret/i);
    return true;
  });
});
