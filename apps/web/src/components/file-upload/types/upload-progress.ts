// apps/web/src/components/file-upload/types/upload-progress.ts

/**
 * Re-export shared upload and session types with frontend-specific additions
 * Uses shared types from @auxx/lib to ensure consistency
 */

// Import all shared types at once for cleaner usage
import type {
  BatchUploadResult,
  ConnectionStatus,
  EntityType,
  // Entity types
  EntityUploadConfig,
  FileInfo,
  // SSE types
  FileUploadEvent,
  MultiFileProgress,
  ProcessingStage,
  QueueConfig,
  QueuedFile,
  QueueStats,
  SessionInfo,
  // Session types
  SessionStatus,
  StageStatus,
  UploadCallbacks,
  UploadFile,
  UploadProgress,
  UploadResult,
  UploadSessionOptions,
  // Upload types
  UploadStatus,
} from '@auxx/lib/files/types'

// Re-export all shared types
export type {
  UploadStatus,
  StageStatus,
  ProcessingStage,
  UploadProgress,
  UploadResult,
  BatchUploadResult,
  QueuedFile,
  QueueStats,
  QueueConfig,
  UploadFile,
  MultiFileProgress,
  UploadCallbacks,
  SessionStatus,
  SessionInfo,
  UploadSessionOptions,
  FileInfo,
  EntityUploadConfig,
  EntityType,
  FileUploadEvent,
  ConnectionStatus,
}

/**
 * Frontend-specific hook return types
 */
export interface UseFileUploadSSEReturn {
  events: FileUploadEvent[]
  isConnected: boolean
  connectionStatus: ConnectionStatus
  error?: string
  connect: () => void
  disconnect: () => void
  clearEvents: () => void
  reconnect: () => void
}

export interface UseFileUploadSessionReturn {
  session?: SessionInfo
  createSession: (options: UploadSessionOptions) => Promise<SessionInfo>
  uploadFiles: (files: File[], options?: UploadSessionOptions) => Promise<BatchUploadResult>
  isUploading: boolean
  progress: BatchUploadResult | null
  errors: string[]
  retryUpload: (fileId: string) => Promise<void>
  cancelUpload: (fileId?: string) => void
  clearErrors: () => void
}

export interface UseUploadQueueReturn {
  queue: QueuedFile[]
  addFiles: (files: File[]) => void
  removeFile: (fileId: string) => void
  clearQueue: () => void
  uploadAll: () => Promise<BatchUploadResult>
  totalProgress: number
  stats: QueueStats
  isUploading: boolean
  config: QueueConfig
  updateConfig: (config: Partial<QueueConfig>) => void
  // REMOVED: pauseAll, resumeAll, retryFailed (offline functionality)
}
