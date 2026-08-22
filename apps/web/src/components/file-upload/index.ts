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
} from './types'
// UI Component Types
export type { FileItemProps } from './ui/file-item'

// Essential Utilities (commonly used)
export { calculateOverallProgress, validateFile } from './utils'
