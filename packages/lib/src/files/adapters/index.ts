// packages/lib/src/files/adapters/index.ts

export type {
  FileMetadata,
  FileRevision,
  MultipartUpload,
  PresignedUpload,
  ProviderAuth,
  ProviderId,
  StorageAdapter,
  StorageAdapterError,
  StorageAuthError,
  StorageCapabilities,
  StorageFileNotFoundError,
  StorageLocationRef,
  StorageQuotaError,
  StorageUnsupportedError,
  WebhookEvent,
} from './base-adapter'
export { BaseStorageAdapter } from './base-adapter'
export { S3Adapter } from './s3-adapter'
