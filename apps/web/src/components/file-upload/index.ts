// apps/web/src/components/file-upload/index.ts

/**
 * Main barrel export for the file upload module
 * Provides a clean interface for importing file upload functionality
 */

// Components
export { FileItem, FileQueueManager } from './components'
// Hooks
export { useFileUpload } from './hooks'
// Hook Types
export type { UseFileUploadOptions, UseFileUploadReturn } from './hooks/use-file-upload'
// Store
export { useUploadStore } from './stores'
// Types
export type {
  BatchUploadResult,
  ConnectionState,
  ConnectionStatus,
  EntityUploadConfig,
  ErrorEvent,
  EventHandler,
  EventHandlers,
  FileInfo,
  FileUploadEvent,
  FileUploadEventBase,
  JobUpdateEvent,
  ProcessingCompletedEvent,
  ProcessingProgressEvent,
  ProcessingStage,
  QueueConfig,
  QueuedFile,
  QueueStats,
  SessionConnectedEvent,
  SessionInfo,
  SessionStatus,
  SSEConfig,
  StageStatus,
  UploadCompletedEvent,
  UploadFile,
  UploadProgress,
  UploadProgressEvent,
  UploadResult,
  UploadSessionOptions,
  UploadStatus,
} from './types'
// UI Component Types
export type { FileItemProps } from './ui/file-item'

// Essential Utilities (commonly used)
export { calculateOverallProgress, validateFile } from './utils'
