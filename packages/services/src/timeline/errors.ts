// packages/services/src/timeline/errors.ts

/**
 * Timeline event not found error
 */
export type TimelineEventNotFoundError = {
  code: 'TIMELINE_EVENT_NOT_FOUND'
  message: string
  eventId?: string
  entityId?: string
}

/**
 * Timeline query error
 */
export type TimelineQueryError = {
  code: 'TIMELINE_QUERY_ERROR'
  message: string
  context?: Record<string, unknown>
}

/**
 * Timeline delete error
 */
export type TimelineDeleteError = {
  code: 'TIMELINE_DELETE_ERROR'
  message: string
  entityId?: string
  entityType?: string
}

/**
 * All timeline-specific errors
 */
export type TimelineError =
  | TimelineEventNotFoundError
  | TimelineQueryError
  | TimelineDeleteError
