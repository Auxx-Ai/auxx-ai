// packages/lib/src/timeline/types.ts

import type { RecordId } from '@auxx/types/resource'
import type { TimelineActorType, TimelineEventType } from './event-types'
import type { TimelineFieldChangeSnapshotValue } from './field-change-snapshot'

export { ContactEventType } from './event-types'

/**
 * One change row stored on a timeline event. New rows carry frozen
 * `oldDisplay` / `newDisplay` snapshots; legacy rows still carry only the
 * raw `oldValue` / `newValue` (the renderer falls back to a best-effort
 * unwrap in that case).
 */
export interface TimelineChange {
  field: string
  /** Field type at write time — used as a hint for empty-state rendering. */
  fieldType?: string
  /** Server-resolved snapshot of the pre-write value. */
  oldDisplay?: TimelineFieldChangeSnapshotValue
  /** Server-resolved snapshot of the post-write value. */
  newDisplay?: TimelineFieldChangeSnapshotValue
  /** Total elements in `oldDisplay` if it was truncated to the array cap. */
  oldDisplayCount?: number
  /** Total elements in `newDisplay` if it was truncated to the array cap. */
  newDisplayCount?: number
  /** Set when the array was capped at the snapshot limit. */
  oldDisplayTruncated?: boolean
  /** Set when the array was capped at the snapshot limit. */
  newDisplayTruncated?: boolean
  /** Legacy raw value — kept through one release for backwards-compat ballast. */
  oldValue?: any
  /** Legacy raw value — kept through one release for backwards-compat ballast. */
  newValue?: any
}

/** Actor who performed the action */
export interface TimelineActor {
  type: TimelineActorType
  id: string
  name?: string
  email?: string
}

/** Base timeline event */
export interface TimelineEventBase {
  id: string
  eventType: TimelineEventType
  startedAt: Date
  endedAt?: Date

  recordId: RecordId
  relatedRecordId?: RecordId

  // Keep for internal DB structure
  entityType: string
  entityId: string
  relatedEntityType?: string
  relatedEntityId?: string

  actor: TimelineActor

  eventData: Record<string, any>
  changes?: TimelineChange[]
  metadata?: Record<string, any>

  isGrouped: boolean
  groupedEventIds?: string[]

  organizationId: string
  createdAt: Date
  updatedAt: Date
}

/** Single timeline event in response */
export interface SingleTimelineEvent {
  type: 'single'
  event: TimelineEventBase
  eventType: TimelineEventType
}

/** Grouped timeline events in response */
export interface GroupedTimelineEvent {
  type: 'group'
  startedAt: Date
  endedAt: Date
  eventType: TimelineEventType
  events: TimelineEventBase[]
}

/** Timeline response item (can be single or grouped) */
export type TimelineItem = SingleTimelineEvent | GroupedTimelineEvent

/** Cursor string used for paginating timeline queries (format: ISO timestamp|eventId) */
export type TimelineCursor = string

/** Timeline query input */
export interface TimelineQueryInput {
  organizationId: string
  recordId: RecordId
  cursor?: TimelineCursor
  limit?: number
  isGroupingDisabled?: boolean
  actorFilter?: string[] // Filter by actor IDs
  eventTypeFilter?: TimelineEventType[] // Filter by event types
}

/** Timeline query result */
export interface TimelineQueryResult {
  events: TimelineItem[]
  nextCursor?: TimelineCursor
  accurateAt: Date
}

/** Input for creating a timeline event */
export interface CreateTimelineEventInput {
  eventType: TimelineEventType
  recordId: RecordId
  relatedRecordId?: RecordId

  actorType: TimelineActorType
  actorId: string

  eventData?: Record<string, any>
  changes?: TimelineChange[]
  metadata?: Record<string, any>

  organizationId: string
  occurredAt?: Date // Defaults to now
}
