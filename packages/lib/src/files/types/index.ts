// packages/lib/src/files/shared-types/index.ts

/**
 * Shared types barrel export for file upload system
 * These types are safe to import from both frontend and backend
 * Contains no server-side dependencies or logic
 */

export type { UploadInitConfig } from '../upload/init-types'
export type {
  ArticleFileMetadata,
  BaseEntityMetadata,
  DatasetFileMetadata,
  EntityCapabilities,
  EntityFileMetadata,
  EntityUploadConfig,
  FileStatus,
  FileVisibility,
  KnowledgeBaseFileMetadata,
  StageConfig,
  TicketFileMetadata,
  ValidationConfig,
  WorkflowFileMetadata,
} from './entities'
// Entity types
export {
  ENTITY_CONFIGS,
  ENTITY_TYPES,
  type EntityType,
  getEntityCapabilities,
  getEntityConfig,
} from './entities'
// Event types
export type {
  BaseFileUploadEvent,
  ErrorData,
  ErrorEvent,
  EventHandler,
  EventHandlers,
  FileUploadEvent,
  FileUploadEventData,
  JobUpdateData,
  JobUpdateEvent,
  ProcessingCompletedEvent,
  ProcessingProgressData,
  ProcessingProgressEvent,
  ProcessingStartedEvent,
  SessionConnectedEvent,
  SessionEventData,
  UploadCompletedEvent,
  UploadProgressData,
  UploadProgressEvent,
  UploadStartedEvent,
} from './events'
export { FileUploadChannels, FileUploadEventType, FileUploadEventValidator } from './events'
// Session types
export type {
  CreateSessionOptions,
  FileInfo,
  SessionCleanupResult,
  SessionConfig,
  SessionData,
  SessionInfo,
  SessionProgress,
  SessionQueryOptions,
  SessionStats,
  SessionStatus,
  SessionUpdate,
  UploadSessionOptions,
} from './sessions'
// Upload types
export type {
  BatchProgressCallback,
  BatchUploadResult,
  CompletionCallback,
  ConnectionConfig,
  ErrorCallback,
  FileValidationResult,
  MultiFileProgress,
  ProcessingStage,
  ProgressCallback,
  QueueConfig,
  QueuedFile,
  QueueStats,
  StageStatus,
  UploadCallbacks,
  UploadFile,
  UploadMetrics,
  UploadResult,
  UploadStatus,
} from './uploads'

// No more processor type exports - EntityType is used directly

// Common types
export type {
  APIResponse,
  BaseEntity,
  BaseRecord,
  CacheConfig,
  ConnectionState,
  ConnectionStatus,
  DeepPartial,
  EnvironmentInfo,
  ErrorResponse,
  FeatureFlag,
  FilterOptions,
  HealthStatus,
  IdentifiableRecord,
  OmitNested,
  OrganizationScopedRecord,
  PaginatedResponse,
  PaginationMeta,
  PaginationOptions,
  PartialBy,
  QueryOptions,
  RateLimitConfig,
  RequireBy,
  RetryConfig,
  SortOptions,
  SSEConfig,
  TimestampedRecord,
  UserAttributedRecord,
} from './common'

export { DataTransforms, TypeGuards } from './common'

// Version information
export const SHARED_TYPES_VERSION = '1.0.0'
