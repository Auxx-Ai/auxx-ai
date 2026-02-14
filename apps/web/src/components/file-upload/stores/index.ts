// apps/web/src/components/file-upload/stores/index.ts

/**
 * File upload store exports
 * Centralized state management with Zustand
 */

// Re-export existing utils instead of duplicating them
export {
  calculateOverallProgress,
  calculateQueueStats as getQueueStats,
  validateFile,
} from '../utils'
// Selectors
export * from './selectors'
export type { FileSlice } from './slices/file-slice'
// Slice types (for extending if needed)
export type { SessionSlice } from './slices/session-slice'
export type { UISlice } from './slices/ui-slice'
// Types
export type {
  CreateSessionOptions,
  FileState,
  SessionState,
  SSEConnectionState,
  UploadActions,
  UploadConfig,
  UploadError,
  UploadState,
  UploadStore,
} from './types'
// Main store
export { cleanupUploader, cleanupUploadStore, useUploadStore } from './upload-store'
