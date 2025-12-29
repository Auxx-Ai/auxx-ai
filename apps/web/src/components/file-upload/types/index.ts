// apps/web/src/components/file-upload/types/index.ts

/**
 * Barrel exports for file upload types
 */

// Event types
export type {
  FileUploadEvent,
  FileUploadEventBase,
  UploadProgressEvent,
  ProcessingProgressEvent,
  UploadCompletedEvent,
  ProcessingCompletedEvent,
  JobUpdateEvent,
  ErrorEvent,
  SessionConnectedEvent,
  EventHandler,
  EventHandlers,
  ConnectionState,
  ConnectionStatus,
  SSEConfig,
} from './upload-events'

// Progress and session types
export type {
  FileInfo,
  UploadFile,
  UploadStatus,
  ProcessingStage,
  StageStatus,
  UploadProgress,
  SessionInfo,
  SessionStatus,
  UploadSessionOptions,
  UploadResult,
  BatchUploadResult,
  QueuedFile,
  QueueStats,
  QueueConfig,
  EntityUploadConfig,
  UseFileUploadSSEReturn,
  UseFileUploadSessionReturn,
  UseUploadQueueReturn,
} from './upload-progress'
