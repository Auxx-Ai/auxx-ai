// apps/web/src/components/file-upload/types/upload-events.ts

/**
 * Re-export shared event types with frontend-specific additions
 * Uses shared types from @auxx/lib to ensure consistency
 */

// Import all shared event types
export type {
  FileUploadEventType,
  BaseFileUploadEvent as FileUploadEventBase,
  FileUploadEvent,
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
} from '@auxx/lib/files/types'
