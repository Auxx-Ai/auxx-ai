// packages/lib/src/timeline/types.ts

import type { TimelineActorType, TimelineEventType } from './event-types'

export { ContactEventType } from './event-types'

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

  entityType: string // Accepts both enum values and custom entity types (entity:definitionId)
  entityId: string

  relatedEntityType?: string
  relatedEntityId?: string

  actor: TimelineActor

  eventData: Record<string, any>
  changes?: {
    field: string
    oldValue: any
    newValue: any
  }[]
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
  entityType: string // Accepts both enum values and custom entity types (entity:definitionId)
  entityId: string
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
  entityType: string // Accepts both enum values and custom entity types (entity:definitionId)
  entityId: string

  relatedEntityType?: string
  relatedEntityId?: string

  actorType: TimelineActorType
  actorId: string

  eventData?: Record<string, any>
  changes?: Array<{
    field: string
    oldValue: any
    newValue: any
  }>
  metadata?: Record<string, any>

  organizationId: string
  occurredAt?: Date // Defaults to now
}
