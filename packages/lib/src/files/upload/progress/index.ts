// packages/lib/src/files/events/index.ts

/**
 * File upload events module
 * Exports all event-related types, schemas, and publishers
 */

// Event schemas and validation
export {
  ErrorEventSchema,
  FileUploadEventSchema,
  FileUploadEventSchemaValidator,
  JobUpdateEventSchema,
  ProcessingCompletedEventSchema,
  ProcessingProgressEventSchema,
  ProcessingStartedEventSchema,
  SessionConnectedEventSchema,
  UploadCompletedEventSchema,
  UploadProgressEventSchema,
  UploadStartedEventSchema,
  type ValidatedErrorEvent,
  type ValidatedFileUploadEvent,
  type ValidatedJobUpdateEvent,
  type ValidatedProcessingCompletedEvent,
  type ValidatedProcessingProgressEvent,
  type ValidatedProcessingStartedEvent,
  type ValidatedSessionConnectedEvent,
  type ValidatedUploadCompletedEvent,
  type ValidatedUploadProgressEvent,
  type ValidatedUploadStartedEvent,
} from './event-schemas'
// Event types and interfaces
export {
  type BaseFileUploadEvent,
  type ErrorData,
  type ErrorEvent,
  FileUploadChannels,
  type FileUploadEvent,
  type FileUploadEventData,
  FileUploadEventType,
  FileUploadEventValidator,
  type JobUpdateData,
  type JobUpdateEvent,
  type ProcessingCompletedEvent,
  type ProcessingProgressData,
  type ProcessingProgressEvent,
  type ProcessingStartedEvent,
  type SessionConnectedEvent,
  type SessionData,
  type UploadCompletedEvent,
  type UploadProgressData,
  type UploadProgressEvent,
  type UploadStartedEvent,
} from './event-types'
