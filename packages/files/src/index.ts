export type FileStatus = 'UPLOADING' | 'QUARANTINED' | 'PROCESSING' | 'READY' | 'REJECTED' | 'DELETED';
export interface StoredFile { readonly id: string; readonly projectId: string; readonly storageKey: string; readonly status: FileStatus; }
