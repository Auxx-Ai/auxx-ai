// apps/web/src/components/file-upload/stores/index.ts

/**
 * File upload store exports
 * Centralized state management with Zustand
 */

// Main store
export { useUploadStore, cleanupUploadStore, cleanupUploader } from './upload-store'

// Types
export type {
  UploadStore,
  UploadState,
  UploadActions,
  FileState,
  SessionState,
  SSEConnectionState,
  UploadError,
  UploadConfig,
  CreateSessionOptions,
} from './types'

// Selectors
export * from './selectors'

// Re-export existing utils instead of duplicating them
export {
  calculateOverallProgress,
  calculateQueueStats as getQueueStats,
  validateFile,
} from '../utils'

// Slice types (for extending if needed)
export type { SessionSlice } from './slices/session-slice'
export type { FileSlice } from './slices/file-slice'
export type { UISlice } from './slices/ui-slice'
