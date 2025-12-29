// packages/lib/src/files/shared-types/index.ts

/**
 * Shared types barrel export for file upload system
 * These types are safe to import from both frontend and backend
 * Contains no server-side dependencies or logic
 */

// Event types
export type {
  BaseFileUploadEvent,
  UploadProgressData,
  ProcessingProgressData,
  JobUpdateData,
  ErrorData,
  SessionEventData,
  UploadStartedEvent,
  UploadProgressEvent,
  UploadCompletedEvent,
  ProcessingStartedEvent,
  ProcessingProgressEvent,
  ProcessingCompletedEvent,
  JobUpdateEvent,
  ErrorEvent,
  SessionConnectedEvent,
  FileUploadEvent,
  FileUploadEventData,
  EventHandler,
  EventHandlers,
} from './events'

export { FileUploadEventType, FileUploadChannels, FileUploadEventValidator } from './events'

// Session types
export type {
  SessionStatus,
  FileInfo,
  SessionConfig,
  SessionData,
  CreateSessionOptions,
  SessionUpdate,
  SessionQueryOptions,
  SessionStats,
  SessionCleanupResult,
  SessionProgress,
  SessionInfo,
  UploadSessionOptions,
} from './sessions'

export type { UploadInitConfig } from '../upload/init-types'

// Upload types
export type {
  UploadStatus,
  StageStatus,
  ProcessingStage,
  UploadResult,
  BatchUploadResult,
  QueuedFile,
  QueueStats,
  QueueConfig,
  FileValidationResult,
  UploadFile,
  MultiFileProgress,
  UploadMetrics,
  ProgressCallback,
  BatchProgressCallback,
  CompletionCallback,
  ErrorCallback,
  UploadCallbacks,
  ConnectionConfig,
} from './uploads'

// Entity types
export { ENTITY_TYPES, type EntityType } from './entities'
export type {
  FileVisibility,
  FileStatus,
  StageConfig,
  ValidationConfig,
  EntityUploadConfig,
  BaseEntityMetadata,
  DatasetFileMetadata,
  TicketFileMetadata,
  ArticleFileMetadata,
  KnowledgeBaseFileMetadata,
  WorkflowFileMetadata,
  EntityFileMetadata,
  EntityCapabilities,
} from './entities'

export { ENTITY_CONFIGS, getEntityConfig, getEntityCapabilities } from './entities'

// No more processor type exports - EntityType is used directly

// Common types
export type {
  APIResponse,
  ErrorResponse,
  PaginationOptions,
  PaginationMeta,
  PaginatedResponse,
  SortOptions,
  FilterOptions,
  QueryOptions,
  TimestampedRecord,
  IdentifiableRecord,
  BaseRecord,
  OrganizationScopedRecord,
  UserAttributedRecord,
  BaseEntity,
  ConnectionState,
  ConnectionStatus,
  SSEConfig,
  RateLimitConfig,
  CacheConfig,
  RetryConfig,
  HealthStatus,
  FeatureFlag,
  EnvironmentInfo,
  PartialBy,
  RequireBy,
  DeepPartial,
  OmitNested,
} from './common'

export { TypeGuards, DataTransforms } from './common'

// Version information
export const SHARED_TYPES_VERSION = '1.0.0'
