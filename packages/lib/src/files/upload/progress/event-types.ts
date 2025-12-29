// packages/lib/src/files/events/event-types.ts

/**
 * File upload event types for SSE communication
 */
export enum FileUploadEventType {
  // Upload Phase Events
  UPLOAD_STARTED = 'upload-started',
  UPLOAD_PROGRESS = 'upload-progress',
  UPLOAD_COMPLETED = 'upload-completed',
  UPLOAD_FAILED = 'upload-failed',

  // Validation Phase Events
  VALIDATION_STARTED = 'validation-started',
  VALIDATION_COMPLETED = 'validation-completed',
  VALIDATION_FAILED = 'validation-failed',

  // Storage Phase Events
  STORAGE_STARTED = 'storage-started',
  STORAGE_COMPLETED = 'storage-completed',
  STORAGE_FAILED = 'storage-failed',

  // Entity Processing Phase Events
  PROCESSING_STARTED = 'processing-started',
  PROCESSING_PROGRESS = 'processing-progress',
  PROCESSING_COMPLETED = 'processing-completed',
  PROCESSING_FAILED = 'processing-failed',

  // Background Job Events
  JOB_QUEUED = 'job-queued',
  JOB_STARTED = 'job-started',
  JOB_PROGRESS = 'job-progress',
  JOB_COMPLETED = 'job-completed',
  JOB_FAILED = 'job-failed',

  // Session and Connection Events
  SESSION_CREATED = 'session-created',
  SESSION_CONNECTED = 'session-connected',
  SESSION_EXPIRED = 'session-expired',

  // Error and Status Events
  ERROR = 'error',
  STATUS_UPDATE = 'status-update',
}

/**
 * Base interface for all file upload events
 */
export interface BaseFileUploadEvent {
  event: FileUploadEventType
  sessionId: string
  timestamp: string
  organizationId: string
}

/**
 * Upload progress data
 */
export interface UploadProgressData {
  fileId?: string
  filename: string
  bytesUploaded: number
  totalBytes: number
  progress: number // 0-100 percentage
  speed?: number // bytes per second
}

/**
 * Processing progress data
 */
export interface ProcessingProgressData {
  stage: string
  stageProgress: number // 0-100 percentage within current stage
  overallProgress: number // 0-100 overall progress
  message?: string
  metadata?: Record<string, any>
}

/**
 * Job update data
 */
export interface JobUpdateData {
  jobType: string
  jobId: string
  status: 'queued' | 'started' | 'progress' | 'completed' | 'failed'
  progress?: number
  message?: string
  result?: any
  error?: string
  queuedAt?: Date
  startedAt?: Date
  updatedAt?: Date
  completedAt?: Date
  failedAt?: Date
}

/**
 * Error data
 */
export interface ErrorData {
  stage: string
  error: string
  recoverable: boolean
  fileId?: string
  suggestedAction?: 'retry' | 'skip' | 'contact_support'
  fallbackAvailable?: boolean
  details?: Record<string, any>
}

/**
 * Session data
 */
export interface SessionData {
  sessionId: string
  entityType: string
  entityId?: string
  userId: string
  organizationId: string
  fileCount: number
  totalSize: number
  status: 'created' | 'active' | 'completed' | 'failed' | 'expired'
  createdAt: Date
  expiresAt: Date
}

/**
 * Specific event interfaces
 */
export interface UploadStartedEvent extends BaseFileUploadEvent {
  event: FileUploadEventType.UPLOAD_STARTED
  data: {
    files: Array<{
      id: string
      name: string
      size: number
      type: string
    }>
    entityType: string
    entityId?: string
  }
}

export interface UploadProgressEvent extends BaseFileUploadEvent {
  event: FileUploadEventType.UPLOAD_PROGRESS
  data: UploadProgressData
}

export interface UploadCompletedEvent extends BaseFileUploadEvent {
  event: FileUploadEventType.UPLOAD_COMPLETED
  data: {
    fileId: string
    filename: string
    url: string
    size: number
    checksum: string
  }
}

export interface ProcessingStartedEvent extends BaseFileUploadEvent {
  event: FileUploadEventType.PROCESSING_STARTED
  data: {
    stage: string
    message?: string
    entityType: string
    entityId?: string
  }
}

export interface ProcessingProgressEvent extends BaseFileUploadEvent {
  event: FileUploadEventType.PROCESSING_PROGRESS
  data: ProcessingProgressData
}

export interface ProcessingCompletedEvent extends BaseFileUploadEvent {
  event: FileUploadEventType.PROCESSING_COMPLETED
  data: {
    stage: string
    message?: string
    result?: any
    overallProgress: number
  }
}

export interface JobUpdateEvent extends BaseFileUploadEvent {
  event:
    | FileUploadEventType.JOB_QUEUED
    | FileUploadEventType.JOB_STARTED
    | FileUploadEventType.JOB_PROGRESS
    | FileUploadEventType.JOB_COMPLETED
    | FileUploadEventType.JOB_FAILED
  data: JobUpdateData
}

export interface ErrorEvent extends BaseFileUploadEvent {
  event: FileUploadEventType.ERROR
  data: ErrorData
}

export interface SessionConnectedEvent extends BaseFileUploadEvent {
  event: FileUploadEventType.SESSION_CONNECTED
  data: {
    connectionId: string
    reconnected: boolean
  }
}

/**
 * Union type for all file upload events
 */
export type FileUploadEvent =
  | UploadStartedEvent
  | UploadProgressEvent
  | UploadCompletedEvent
  | ProcessingStartedEvent
  | ProcessingProgressEvent
  | ProcessingCompletedEvent
  | JobUpdateEvent
  | ErrorEvent
  | SessionConnectedEvent

/**
 * Event data type mapping
 */
export type FileUploadEventData<T extends FileUploadEventType> =
  T extends FileUploadEventType.UPLOAD_STARTED
    ? UploadStartedEvent['data']
    : T extends FileUploadEventType.UPLOAD_PROGRESS
      ? UploadProgressEvent['data']
      : T extends FileUploadEventType.UPLOAD_COMPLETED
        ? UploadCompletedEvent['data']
        : T extends FileUploadEventType.PROCESSING_STARTED
          ? ProcessingStartedEvent['data']
          : T extends FileUploadEventType.PROCESSING_PROGRESS
            ? ProcessingProgressEvent['data']
            : T extends FileUploadEventType.PROCESSING_COMPLETED
              ? ProcessingCompletedEvent['data']
              : T extends FileUploadEventType.JOB_QUEUED
                ? JobUpdateEvent['data']
                : T extends FileUploadEventType.JOB_STARTED
                  ? JobUpdateEvent['data']
                  : T extends FileUploadEventType.JOB_PROGRESS
                    ? JobUpdateEvent['data']
                    : T extends FileUploadEventType.JOB_COMPLETED
                      ? JobUpdateEvent['data']
                      : T extends FileUploadEventType.JOB_FAILED
                        ? JobUpdateEvent['data']
                        : T extends FileUploadEventType.ERROR
                          ? ErrorEvent['data']
                          : T extends FileUploadEventType.SESSION_CONNECTED
                            ? SessionConnectedEvent['data']
                            : never

/**
 * Channel naming utilities
 */
export class FileUploadChannels {
  /**
   * Primary channel for upload session events
   */
  static session(sessionId: string): string {
    return `file:upload:${sessionId}`
  }

  /**
   * Entity-specific channel for processing events
   */
  static entity(entityType: string, entityId: string): string {
    return `file:entity:${entityType}:${entityId}`
  }

  /**
   * Organization-scoped channel for batch operations
   */
  static organization(organizationId: string): string {
    return `file:org:${organizationId}`
  }

  /**
   * Job-specific channel for background job updates
   */
  static job(jobId: string): string {
    return `file:job:${jobId}`
  }
}

/**
 * Event validation utilities
 */
export class FileUploadEventValidator {
  /**
   * Validate event has required fields
   */
  static isValidEvent(event: any): event is FileUploadEvent {
    return (
      event &&
      typeof event.event === 'string' &&
      typeof event.sessionId === 'string' &&
      typeof event.timestamp === 'string' &&
      typeof event.organizationId === 'string' &&
      event.data !== undefined
    )
  }

  /**
   * Validate specific event type
   */
  static isEventOfType<T extends FileUploadEventType>(
    event: FileUploadEvent,
    eventType: T
  ): event is Extract<FileUploadEvent, { event: T }> {
    return event.event === eventType
  }
}
