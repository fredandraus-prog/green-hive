export interface Profile {
  readonly userId: string;
  readonly displayName: string | null;
  readonly preferredLanguage: string;
  readonly preferredLocale: string;
  readonly timezone: string;
  readonly updatedAt?: string;
}

export interface AccountView {
  readonly email: string;
  readonly profile: Profile;
}

export interface Project {
  readonly id: string;
  readonly organizationId: string;
  readonly name: string;
  readonly status: 'DRAFT' | 'ACTIVE' | 'ARCHIVED' | 'DELETED';
  readonly createdAt: string;
  readonly archivedAt: string | null;
}

export interface Workspace {
  readonly id: string;
  readonly name: string;
  readonly kind: 'PERSONAL' | 'SHARED';
  readonly status: 'ACTIVE' | 'ARCHIVED';
  readonly role: 'OWNER' | 'ADMIN' | 'DEVELOPER' | 'ANALYST' | 'VIEWER';
  readonly appRelationship: 'NATIVE' | 'CONNECTED' | 'MIGRATING';
}

export interface AuditEvent {
  readonly id: string;
  readonly eventCode: string;
  readonly outcome: 'SUCCEEDED' | 'DENIED' | 'FAILED';
  readonly metadata: Readonly<Record<string, boolean | number | string | null>>;
  readonly occurredAt: string;
}
