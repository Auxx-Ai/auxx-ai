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

import type { FileUploadEvent, FileUploadEventType } from '@auxx/lib/files/types'

/**
 * Opening frame of `/api/files/upload/[sessionId]/events` — the route emits it under the wire
 * name `session-status`, which lib's `FileUploadEventType` enum does not carry at all.
 */
export interface SessionStatusEvent {
  event: 'session-status'
  sessionId: string
  status: string
  timestamp: string
  data?: unknown
}

/**
 * Redis session-status fan-out, republished verbatim by the same route. `FileUploadEventType`
 * declares `STATUS_UPDATE`, but lib's `FileUploadEvent` union has no member for it.
 */
export interface StatusUpdateEvent {
  event: FileUploadEventType.STATUS_UPDATE
  sessionId?: string
  data?: { status?: string; progress?: number } | undefined
}

/**
 * Every event the upload SSE stream can deliver: lib's shared union plus the two frames this
 * app's own route emits.
 */
export type UploadSseEvent = FileUploadEvent | SessionStatusEvent | StatusUpdateEvent
