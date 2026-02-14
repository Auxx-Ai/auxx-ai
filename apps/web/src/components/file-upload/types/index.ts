// apps/web/src/components/file-upload/types/index.ts

/**
 * Barrel exports for file upload types
 */

// Event types
export type {
  ConnectionState,
  ConnectionStatus,
  ErrorEvent,
  EventHandler,
  EventHandlers,
  FileUploadEvent,
  FileUploadEventBase,
  JobUpdateEvent,
  ProcessingCompletedEvent,
  ProcessingProgressEvent,
  SessionConnectedEvent,
  SSEConfig,
  UploadCompletedEvent,
  UploadProgressEvent,
} from './upload-events'

// Progress and session types
export type {
  BatchUploadResult,
  EntityUploadConfig,
  FileInfo,
  ProcessingStage,
  QueueConfig,
  QueuedFile,
  QueueStats,
  SessionInfo,
  SessionStatus,
  StageStatus,
  UploadFile,
  UploadProgress,
  UploadResult,
  UploadSessionOptions,
  UploadStatus,
  UseFileUploadSessionReturn,
  UseFileUploadSSEReturn,
  UseUploadQueueReturn,
} from './upload-progress'
