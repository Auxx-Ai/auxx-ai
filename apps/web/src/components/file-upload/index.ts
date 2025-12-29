// apps/web/src/components/file-upload/index.ts

/**
 * Main barrel export for the file upload module
 * Provides a clean interface for importing file upload functionality
 */

// Components
export { FileItem, FileQueueManager } from './components'

// Store
export { useUploadStore } from './stores'

// Hooks
export { useFileUpload } from './hooks'

// Types
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
} from './types'

// UI Component Types
export type { FileItemProps } from './ui/file-item'

// Hook Types
export type { UseFileUploadOptions, UseFileUploadReturn } from './hooks/use-file-upload'

// Essential Utilities (commonly used)
export { validateFile, calculateOverallProgress } from './utils'
