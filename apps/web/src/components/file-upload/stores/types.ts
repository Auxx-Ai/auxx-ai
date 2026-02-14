// apps/web/src/components/file-upload/stores/types.ts

import type {
  BatchUploadResult,
  EntityType,
  FileUploadEvent,
  ProcessingStage,
  SessionStatus,
  UploadProgress,
} from '@auxx/lib/files/types'

/**
 * Core store state types
 */

export interface EntityConfig {
  entityType: EntityType
  entityId?: string
  metadata?: Record<string, any>
}

export interface CallbackConfig {
  onComplete?: (results: BatchUploadResult) => void
  onError?: (error: string) => void
  onProgress?: (progress: BatchUploadResult) => void
}

export interface FileState {
  // Core FileItem-compatible fields
  id: string // Use tempFileId as primary id
  tempFileId: string // consistent ID used throughout upload lifecycle
  name: string
  type: 'file' // Always 'file' for uploads
  size?: bigint | null // Convert from number to bigint for consistency
  displaySize: number // Computed from size for UI
  mimeType?: string | null // Renamed from 'type' field
  ext?: string | null // Computed from file name
  createdAt: Date // Upload start time
  updatedAt: Date // Last update time
  path: string // Target folder path
  parentId?: string | null // Target folder ID
  isArchived?: boolean // Always false for new uploads

  // Upload/processing state (FileItem compatible)
  status: 'pending' | 'uploading' | 'processing' | 'completed' | 'failed' | 'cancelled' | 'deleting'
  progress?: number // 0-100 progress percentage
  error?: string // Error message if failed
  isUploading: true // Always true for upload files
  source?: 'upload' | 'filesystem' // Source of the file (always 'upload' for FileState)
  tempId?: string // Same as tempFileId
  serverFileId?: string // Server ID after upload completes
  url?: string // File URL if available

  // Upload-specific fields (not in FileItem)
  file?: File // Original File object for upload
  entityType?: EntityType
  stages: ProcessingStage[]
  checksum?: string
  metadata?: {
    targetFolderId?: string | null // Target folder for upload
    [key: string]: any // Allow additional metadata
  }
  // REMOVED: retryCount, uploadedAt, completedAt (offline-related fields)
}

export interface SessionState {
  id: string
  entityType: EntityType
  entityId?: string

  // Validation configuration per session
  validationConfig?: {
    maxFiles?: number
    maxFileSize?: number // in bytes
    fileExtensions?: string[] // e.g., ['.jpg', '.png']
    allowedMimeTypes?: string[] // e.g., ['image/*', 'application/pdf']
  }

  // Behavior configuration per session
  behaviorConfig?: {
    allowMultiple?: boolean
    autoStart?: boolean
    autoCreateSession?: boolean
    confirmBeforeCancel?: boolean
    showThumbnails?: boolean
  }

  // Session-specific callbacks
  callbacks?: {
    onChange?: (files: FileState[]) => void
    onComplete?: (results: BatchUploadResult) => void
    onError?: (error: string) => void
    onProgress?: (progress: BatchUploadResult) => void
  }

  // Additional upload configuration
  uploadConfig?: {
    chunkSize?: number
    maxConcurrentUploads?: number
    [key: string]: any // extensible
  }

  status: SessionStatus
  fileIds: string[]
  uploading?: boolean // Per-session upload state
  uploadStartTime?: number
  uploadResult?: BatchUploadResult
  uploadError?: string
  overallProgress: number
  createdAt: Date
  updatedAt: Date
  completedAt?: Date
  metadata: Record<string, any>
  sseConnection?: SSEConnectionState
  // REMOVED: expiresAt, startedAt (offline persistence fields)
  // REMOVED: organizationId, userId (auth handled server-side)
}

export interface SSEConnectionState {
  sessionId: string
  status: 'disconnected' | 'connecting' | 'connected' | 'reconnecting' | 'failed'
  error?: string
  lastConnected?: Date
  reconnectAttempts: number
  eventSource?: EventSource
  cleanup?: () => void
  manager?: any // SSEConnectionManager - use any to avoid circular imports
}

export interface UploadError {
  id: string
  message: string
  code?: string
  fileId?: string
  sessionId?: string
  timestamp: Date
  recoverable: boolean
}

export interface UploadConfig {
  maxConcurrentUploads: number
  chunkSize: number
  showThumbnails: boolean
  confirmBeforeCancel: boolean
  // REMOVED: autoRetry, maxRetryAttempts (offline retry functionality)
}

/**
 * Store state interface
 */
export interface UploadState {
  // Session Management
  sessions: Record<string, SessionState>
  activeSessionId: string | null

  // File Management
  files: Record<string, FileState>
  queue: string[] // Ordered list of file IDs
  fileIdToSessionId: Record<string, string> // Fast reverse lookup

  // New: Pending file IDs only (not full FileState) - avoids duplication
  pendingFileIds: Record<string, string[]> // uploaderId -> fileId[]

  // New: Mapping of uploaderId to sessionId (primary source of truth)
  uploaderSessions: Record<string, string> // uploaderId -> sessionId

  // Connection State
  sseConnections: Record<string, SSEConnectionState>

  // UI State
  dragActive: boolean
  uploading: boolean

  // Abort controller for cancellation
  abortController: AbortController | null

  // Per-file abort tracking for presigned uploads
  inFlight: Record<string, { abort?: () => void }>
  // REMOVED: paused (offline pause/resume functionality)

  // Error State
  errors: UploadError[]

  // Configuration
  config: UploadConfig

  // Entity Configuration
  entityConfig: EntityConfig | null
  callbacks: CallbackConfig
}

/**
 * Store actions interface - updated for unified architecture
 */
export interface UploadActions {
  // Unified Session Actions (includes SSE)
  createSession: (options: CreateSessionOptions) => Promise<string>
  selectSession: (sessionId: string) => void
  closeSession: (sessionId: string) => void
  updateSessionProgress: (sessionId: string, progress: number) => void
  connectSSE: (sessionId: string) => void
  disconnectSSE: (sessionId: string) => void
  handleSSEEvent: (sessionId: string, event: FileUploadEvent) => void

  // File Actions
  addFiles: (files: File[], sessionId?: string, entityType?: EntityType) => string[] // Return created IDs
  removeFile: (fileId: string) => void
  removeFiles: (fileIds: string[]) => void // Batch remove
  updateFileProgress: (fileId: string, progress: Partial<UploadProgress>) => void
  updateFileStatus: (fileId: string, status: FileState['status']) => void
  setFileError: (fileId: string, error: string) => void // Error helper
  cancelFile: (fileId: string) => void
  retryFile: (fileId: string) => void

  // Enhanced Orchestration Actions
  initializeUpload: (options: InitializeUploadOptions) => Promise<string>
  addFilesWithValidation: (
    files: File[],
    uploaderId: string,
    options?: {
      maxFiles?: number
      maxFileSize?: number
      fileExtensions?: string[]
      allowedMimeTypes?: string[]
    }
  ) => Promise<{ addedFileIds: string[]; validationErrors: string[] }>
  startUpload: () => Promise<BatchUploadResult>
  startUploadForSession: (sessionId: string) => Promise<BatchUploadResult>
  createSessionWithGuard: (uploaderId: string, options: CreateSessionOptions) => Promise<string>
  cancelUpload: () => void
  validateAndAddFiles: (
    files: File[],
    sessionId?: string
  ) => Promise<{ validFiles: File[]; errors: string[] }>
  handleAPIResponse: (response: any, sessionId: string) => void
  coordinateSSEEvents: (sessionId: string) => void
  calculateOverallProgress: (sessionId: string) => number
  associateFilesWithSession: (fileIds: string[], sessionId: string) => void
  retrySession: (sessionId: string) => Promise<void>
  cleanupSession: (sessionId: string) => void
  clearQueue: () => void

  // Presigned upload tracking methods
  setInFlight: (fileId: string, abort?: () => void) => void
  clearInFlight: (fileId: string) => void

  // UI Actions
  setDragActive: (active: boolean) => void
  setUploading: (uploading: boolean) => void

  // Error Actions
  addError: (error: Omit<UploadError, 'id' | 'timestamp'>) => void
  removeError: (errorId: string) => void
  clearErrors: () => void

  // Config Actions
  updateConfig: (config: Partial<UploadConfig>) => void

  // Utility Actions
  reset: () => void
  cleanup: () => void

  // Entity Configuration Actions
  setEntityConfig: (config: EntityConfig) => void
  setCallbacks: (callbacks: CallbackConfig) => void
  triggerCallback: (type: 'complete' | 'error' | 'progress', data: any) => void

  // Toast Integration Actions
  showSuccessToast: (title: string, description: string) => void
  showErrorToast: (title: string, description: string) => void
}

export interface CreateSessionOptions {
  entityType: EntityType
  entityId?: string
  files?: File[]

  // Pass all session-scoped configurations
  validationConfig?: SessionState['validationConfig']
  behaviorConfig?: SessionState['behaviorConfig']
  callbacks?: SessionState['callbacks']
  uploadConfig?: SessionState['uploadConfig']

  metadata?: {
    createAsset?: boolean
    role?: string
    folderId?: string
    title?: string
    caption?: string
    isPublic?: boolean
    isTemporary?: boolean
    expiresAt?: string
    generateThumbnails?: boolean
    extractText?: boolean
    enableCompression?: boolean
    [key: string]: any // Allow additional properties
  }
  // REMOVED: expirationHours (offline persistence)
  // REMOVED: organizationId, userId (auth handled server-side)
}

export interface InitializeUploadOptions {
  entityType: EntityType
  entityId?: string
  files?: File[]
  metadata?: Record<string, any>
  autoStart?: boolean
}

export type UploadStore = UploadState & UploadActions
