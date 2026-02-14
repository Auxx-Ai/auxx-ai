// apps/web/src/components/file-upload/types/upload-events.ts

/**
 * Re-export shared event types with frontend-specific additions
 * Uses shared types from @auxx/lib to ensure consistency
 */

// Import all shared event types
export type {
  BaseFileUploadEvent as FileUploadEventBase,
  ConnectionState,
  ConnectionStatus,
  ErrorEvent,
  EventHandler,
  EventHandlers,
  FileUploadEvent,
  FileUploadEventType,
  JobUpdateEvent,
  ProcessingCompletedEvent,
  ProcessingProgressEvent,
  SessionConnectedEvent,
  SSEConfig,
  UploadCompletedEvent,
  UploadProgressEvent,
} from '@auxx/lib/files/types'
