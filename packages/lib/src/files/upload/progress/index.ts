// packages/lib/src/files/events/index.ts

/**
 * File upload events module
 * Exports all event-related types, schemas, and publishers
 */

// Event types and interfaces
export {
  FileUploadEventType,
  FileUploadChannels,
  FileUploadEventValidator,
  type BaseFileUploadEvent,
  type FileUploadEvent,
  type FileUploadEventData,
  type UploadProgressData,
  type ProcessingProgressData,
  type JobUpdateData,
  type ErrorData,
  type SessionData,
  type UploadStartedEvent,
  type UploadProgressEvent,
  type UploadCompletedEvent,
  type ProcessingStartedEvent,
  type ProcessingProgressEvent,
  type ProcessingCompletedEvent,
  type JobUpdateEvent,
  type ErrorEvent,
  type SessionConnectedEvent,
} from './event-types'

// Event schemas and validation
export {
  FileUploadEventSchema,
  FileUploadEventSchemaValidator,
  UploadStartedEventSchema,
  UploadProgressEventSchema,
  UploadCompletedEventSchema,
  ProcessingStartedEventSchema,
  ProcessingProgressEventSchema,
  ProcessingCompletedEventSchema,
  JobUpdateEventSchema,
  ErrorEventSchema,
  SessionConnectedEventSchema,
  type ValidatedFileUploadEvent,
  type ValidatedUploadStartedEvent,
  type ValidatedUploadProgressEvent,
  type ValidatedUploadCompletedEvent,
  type ValidatedProcessingStartedEvent,
  type ValidatedProcessingProgressEvent,
  type ValidatedProcessingCompletedEvent,
  type ValidatedJobUpdateEvent,
  type ValidatedErrorEvent,
  type ValidatedSessionConnectedEvent,
} from './event-schemas'

// Event publisher
// export { FileUploadEventPublisher, fileUploadEventPublisher } from './file-upload-event-publisher'
import { FileUploadEventPublisher } from './sse-publisher'
