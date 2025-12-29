// packages/database/src/db/schema/timeline-event.ts
// Drizzle table: timelineEvent

import {
  pgTable,
  index,
  text,
  timestamp,
  jsonb,
  type AnyPgColumn,
  boolean,
} from './_shared'
import { createId } from '@paralleldrive/cuid2'
import { Organization } from './organization'

/** Drizzle table for timelineEvent */
export const TimelineEvent = pgTable(
  'TimelineEvent',
  {
    id: text()
      .$defaultFn(() => createId())
      .primaryKey()
      .notNull(),

    // Event metadata
    eventType: text().notNull(), // e.g., 'contact:created', 'contact:field:updated'
    startedAt: timestamp({ precision: 3 }).notNull(), // When the event occurred
    endedAt: timestamp({ precision: 3 }), // For grouped events, when the last event in group occurred

    // Entity tracking
    entityType: text().notNull(), // 'contact', 'ticket', 'thread', 'order'
    entityId: text().notNull(), // The primary entity this event is about

    // Related entity (optional - for events like "contact:ticket:created")
    relatedEntityType: text(), // e.g., 'ticket' when event is 'contact:ticket:created'
    relatedEntityId: text(), // ID of the related entity

    // Actor (who performed the action)
    actorType: text(), // 'user', 'system', 'automation', 'api'
    actorId: text(), // User ID or system identifier

    // Event data
    eventData: jsonb().default({}).notNull(), // Flexible storage for event-specific data
    changes: jsonb(), // For update events, stores old -> new values
    metadata: jsonb(), // Additional metadata (IP, user agent, etc.)

    // Grouping
    isGrouped: boolean().default(false).notNull(), // Is this a grouped event
    groupedEventIds: text().array(), // IDs of individual events that were grouped

    // Organization
    organizationId: text()
      .notNull()
      .references((): AnyPgColumn => Organization.id, {
        onUpdate: 'cascade',
        onDelete: 'cascade',
      }),

    // Timestamps
    createdAt: timestamp({ precision: 3 }).defaultNow().notNull(),
    updatedAt: timestamp({ precision: 3 }).notNull(),
  },
  (table) => [
    // Primary lookup: Get timeline for an entity
    index('TimelineEvent_entity_idx').using(
      'btree',
      table.organizationId.asc().nullsLast(),
      table.entityType.asc().nullsLast(),
      table.entityId.asc().nullsLast(),
      table.startedAt.desc().nullsFirst()
    ),

    // Actor lookup: Get all actions by a user
    index('TimelineEvent_actor_idx').using(
      'btree',
      table.organizationId.asc().nullsLast(),
      table.actorType.asc().nullsLast(),
      table.actorId.asc().nullsLast(),
      table.startedAt.desc().nullsFirst()
    ),

    // Event type lookup: Get all events of a specific type
    index('TimelineEvent_type_idx').using(
      'btree',
      table.organizationId.asc().nullsLast(),
      table.eventType.asc().nullsLast(),
      table.startedAt.desc().nullsFirst()
    ),

    // Related entity lookup: e.g., "show all contact events related to this ticket"
    index('TimelineEvent_related_entity_idx').using(
      'btree',
      table.organizationId.asc().nullsLast(),
      table.relatedEntityType.asc().nullsLast(),
      table.relatedEntityId.asc().nullsLast(),
      table.startedAt.desc().nullsFirst()
    ),

    // Organization-wide timeline
    index('TimelineEvent_org_timeline_idx').using(
      'btree',
      table.organizationId.asc().nullsLast(),
      table.startedAt.desc().nullsFirst()
    ),
  ]
)
