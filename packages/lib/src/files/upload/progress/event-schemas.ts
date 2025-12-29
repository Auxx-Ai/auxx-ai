// packages/lib/src/files/events/event-schemas.ts

import { z } from 'zod'
import { FileUploadEventType } from '../../types'

/**
 * Base schema for all file upload events
 */
const BaseFileUploadEventSchema = z.object({
  event: z.enum(FileUploadEventType),
  sessionId: z.string(),
  timestamp: z.string(),
  organizationId: z.string(),
})

/**
 * Upload progress data schema
 */
const UploadProgressDataSchema = z.object({
  fileId: z.string().optional(),
  filename: z.string(),
  bytesUploaded: z.number().min(0),
  totalBytes: z.number().min(1),
  progress: z.number().min(0).max(100),
  speed: z.number().optional(),
})

/**
 * Processing progress data schema
 */
const ProcessingProgressDataSchema = z.object({
  stage: z.string(),
  stageProgress: z.number().min(0).max(100),
  overallProgress: z.number().min(0).max(100),
  message: z.string().optional(),
  metadata: z.record(z.string(), z.any()).optional(),
})

/**
 * Job update data schema
 */
const JobUpdateDataSchema = z.object({
  jobType: z.string(),
  jobId: z.string(),
  status: z.enum(['queued', 'started', 'progress', 'completed', 'failed']),
  progress: z.number().min(0).max(100).optional(),
  message: z.string().optional(),
  result: z.any().optional(),
  error: z.string().optional(),
  queuedAt: z.date().optional(),
  startedAt: z.date().optional(),
  updatedAt: z.date().optional(),
  completedAt: z.date().optional(),
  failedAt: z.date().optional(),
})

/**
 * Error data schema
 */
const ErrorDataSchema = z.object({
  stage: z.string(),
  error: z.string(),
  recoverable: z.boolean(),
  fileId: z.string().optional(),
  suggestedAction: z.enum(['retry', 'skip', 'contact_support']).optional(),
  fallbackAvailable: z.boolean().optional(),
  details: z.record(z.string(), z.any()).optional(),
})

/**
 * Session data schema
 */
const SessionDataSchema = z.object({
  sessionId: z.string(),
  entityType: z.string(),
  entityId: z.string().optional(),
  userId: z.string(),
  organizationId: z.string(),
  fileCount: z.number().min(0),
  totalSize: z.number().min(0),
  status: z.enum(['created', 'active', 'completed', 'failed', 'expired']),
  createdAt: z.date(),
  expiresAt: z.date(),
})

/**
 * File info schema
 */
const FileInfoSchema = z.object({
  id: z.string(),
  name: z.string(),
  size: z.number().min(0),
  type: z.string(),
})

/**
 * Upload started event schema
 */
export const UploadStartedEventSchema = BaseFileUploadEventSchema.extend({
  event: z.literal(FileUploadEventType.UPLOAD_STARTED),
  data: z.object({
    files: z.array(FileInfoSchema),
    entityType: z.string(),
    entityId: z.string().optional(),
  }),
})

/**
 * Upload progress event schema
 */
export const UploadProgressEventSchema = BaseFileUploadEventSchema.extend({
  event: z.literal(FileUploadEventType.UPLOAD_PROGRESS),
  data: UploadProgressDataSchema,
})

/**
 * Upload completed event schema
 */
export const UploadCompletedEventSchema = BaseFileUploadEventSchema.extend({
  event: z.literal(FileUploadEventType.UPLOAD_COMPLETED),
  data: z.object({
    fileId: z.string(),
    filename: z.string(),
    url: z.string(),
    size: z.number().min(0),
    checksum: z.string(),
  }),
})

/**
 * Processing started event schema
 */
export const ProcessingStartedEventSchema = BaseFileUploadEventSchema.extend({
  event: z.literal(FileUploadEventType.PROCESSING_STARTED),
  data: z.object({
    stage: z.string(),
    message: z.string().optional(),
    entityType: z.string(),
    entityId: z.string().optional(),
  }),
})

/**
 * Processing progress event schema
 */
export const ProcessingProgressEventSchema = BaseFileUploadEventSchema.extend({
  event: z.literal(FileUploadEventType.PROCESSING_PROGRESS),
  data: ProcessingProgressDataSchema,
})

/**
 * Processing completed event schema
 */
export const ProcessingCompletedEventSchema = BaseFileUploadEventSchema.extend({
  event: z.literal(FileUploadEventType.PROCESSING_COMPLETED),
  data: z.object({
    stage: z.string(),
    message: z.string().optional(),
    result: z.any().optional(),
    overallProgress: z.number().min(0).max(100),
  }),
})

/**
 * Job update event schema
 */
export const JobUpdateEventSchema = BaseFileUploadEventSchema.extend({
  event: z.enum([
    FileUploadEventType.JOB_QUEUED,
    FileUploadEventType.JOB_STARTED,
    FileUploadEventType.JOB_PROGRESS,
    FileUploadEventType.JOB_COMPLETED,
    FileUploadEventType.JOB_FAILED,
  ]),
  data: JobUpdateDataSchema,
})

/**
 * Error event schema
 */
export const ErrorEventSchema = BaseFileUploadEventSchema.extend({
  event: z.literal(FileUploadEventType.ERROR),
  data: ErrorDataSchema,
})

/**
 * Session connected event schema
 */
export const SessionConnectedEventSchema = BaseFileUploadEventSchema.extend({
  event: z.literal(FileUploadEventType.SESSION_CONNECTED),
  data: z.object({
    connectionId: z.string(),
    reconnected: z.boolean(),
  }),
})

/**
 * Union schema for all file upload events
 */
export const FileUploadEventSchema = z.discriminatedUnion('event', [
  UploadStartedEventSchema,
  UploadProgressEventSchema,
  UploadCompletedEventSchema,
  ProcessingStartedEventSchema,
  ProcessingProgressEventSchema,
  ProcessingCompletedEventSchema,
  JobUpdateEventSchema,
  ErrorEventSchema,
  SessionConnectedEventSchema,
])

/**
 * Validation helper functions
 */
export class FileUploadEventSchemaValidator {
  /**
   * Validate any file upload event
   */
  static validate(event: unknown) {
    return FileUploadEventSchema.safeParse(event)
  }

  /**
   * Validate upload started event
   */
  static validateUploadStarted(event: unknown) {
    return UploadStartedEventSchema.safeParse(event)
  }

  /**
   * Validate upload progress event
   */
  static validateUploadProgress(event: unknown) {
    return UploadProgressEventSchema.safeParse(event)
  }

  /**
   * Validate processing progress event
   */
  static validateProcessingProgress(event: unknown) {
    return ProcessingProgressEventSchema.safeParse(event)
  }

  /**
   * Validate job update event
   */
  static validateJobUpdate(event: unknown) {
    return JobUpdateEventSchema.safeParse(event)
  }

  /**
   * Validate error event
   */
  static validateError(event: unknown) {
    return ErrorEventSchema.safeParse(event)
  }
}

/**
 * Type exports for schemas
 */
export type ValidatedFileUploadEvent = z.infer<typeof FileUploadEventSchema>
export type ValidatedUploadStartedEvent = z.infer<typeof UploadStartedEventSchema>
export type ValidatedUploadProgressEvent = z.infer<typeof UploadProgressEventSchema>
export type ValidatedUploadCompletedEvent = z.infer<typeof UploadCompletedEventSchema>
export type ValidatedProcessingStartedEvent = z.infer<typeof ProcessingStartedEventSchema>
export type ValidatedProcessingProgressEvent = z.infer<typeof ProcessingProgressEventSchema>
export type ValidatedProcessingCompletedEvent = z.infer<typeof ProcessingCompletedEventSchema>
export type ValidatedJobUpdateEvent = z.infer<typeof JobUpdateEventSchema>
export type ValidatedErrorEvent = z.infer<typeof ErrorEventSchema>
export type ValidatedSessionConnectedEvent = z.infer<typeof SessionConnectedEventSchema>
