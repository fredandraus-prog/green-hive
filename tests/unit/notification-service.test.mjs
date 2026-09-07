import assert from 'node:assert/strict';
import test from 'node:test';
import { NotificationError, NotificationService } from '../../packages/notifications/dist/index.js';

const context = Object.freeze({
  userId: '10000000-0000-4000-8000-000000000001',
  appCode: 'REFERENCE_APP',
  organizationId: '20000000-0000-4000-8000-000000000001',
});

const notification = Object.freeze({
  id: '30000000-0000-4000-8000-000000000001',
  organizationId: context.organizationId,
  appId: '00000000-0000-4000-8000-000000000001',
  projectId: '40000000-0000-4000-8000-000000000001',
  recipientUserId: context.userId,
  jobId: '50000000-0000-4000-8000-000000000001',
  eventType: 'JOB_COMPLETED',
  title: 'Processamento concluído',
  body: 'Uma tarefa do seu projeto foi concluída.',
  status: 'UNREAD',
  metadata: Object.freeze({ jobType: 'REFERENCE_APP_RENDER_PROJECT_DOCUMENT' }),
  createdAt: new Date('2026-09-07T10:00:00.000Z'),
  readAt: null,
});

class FakeRepository {
  calls = [];
  async list(receivedContext, input) { this.calls.push(['list', receivedContext, input]); return [notification]; }
  async markRead(receivedContext, id) {
    this.calls.push(['markRead', receivedContext, id]);
    return id === notification.id ? { ...notification, status: 'READ', readAt: new Date('2026-09-07T10:01:00.000Z') } : null;
  }
}

test('GH-0604 lists bounded notifications and acknowledges only a validated id', async () => {
  const repository = new FakeRepository();
  const service = new NotificationService(repository);
  assert.deepEqual(await service.list(context, { limit: 10 }), [notification]);
  const read = await service.markRead(context, notification.id);
  assert.equal(read.status, 'READ');
  assert.equal(repository.calls[0][2].limit, 10);
  assert.equal(repository.calls[1][2], notification.id);
});

test('GH-0604 rejects client-forged scope, invalid bounds and hidden foreign ids', async () => {
  const service = new NotificationService(new FakeRepository());
  await assert.rejects(service.list({ ...context, platformRole: 'PLATFORM_ADMIN' }), (error) => error instanceof NotificationError && error.code === 'NOTIFICATION_ACCESS_DENIED');
  await assert.rejects(service.list(context, { limit: 101 }), (error) => error instanceof NotificationError && error.code === 'NOTIFICATION_INVALID_INPUT');
  await assert.rejects(service.markRead(context, 'not-a-uuid'), (error) => error instanceof NotificationError && error.code === 'NOTIFICATION_INVALID_INPUT');
  await assert.rejects(service.markRead(context, '30000000-0000-4000-8000-000000000002'), (error) => error instanceof NotificationError && error.code === 'NOTIFICATION_NOT_FOUND');
});
