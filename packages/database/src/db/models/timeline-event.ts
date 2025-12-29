// packages/database/src/db/models/timeline-event.ts
// TimelineEvent model built on BaseModel (org-scoped)

import { TimelineEvent } from '../schema/timeline-event'
import { BaseModel } from '../utils/base-model'

/** Selected TimelineEvent entity type */
export type TimelineEventEntity = typeof TimelineEvent.$inferSelect
/** Insertable TimelineEvent input type */
export type CreateTimelineEventInput = typeof TimelineEvent.$inferInsert
/** Updatable TimelineEvent input type */
export type UpdateTimelineEventInput = Partial<CreateTimelineEventInput>

/**
 * TimelineEventModel encapsulates CRUD for the TimelineEvent table.
 * Org-scoped via organizationId when provided to the constructor.
 */
export class TimelineEventModel extends BaseModel<
  typeof TimelineEvent,
  CreateTimelineEventInput,
  TimelineEventEntity,
  UpdateTimelineEventInput
> {
  /** Drizzle table */
  get table() {
    return TimelineEvent
  }
}
