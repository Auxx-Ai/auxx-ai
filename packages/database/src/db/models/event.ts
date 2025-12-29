// packages/database/src/db/models/event.ts
// Event model built on BaseModel (org-scoped)

import { Event } from '../schema/event'
import { BaseModel } from '../utils/base-model'

/** Selected Event entity type */
export type EventEntity = typeof Event.$inferSelect
/** Insertable Event input type */
export type CreateEventInput = typeof Event.$inferInsert
/** Updatable Event input type */
export type UpdateEventInput = Partial<CreateEventInput>

/**
 * EventModel encapsulates CRUD for the Event table.
 * Org-scoped via organizationId when provided to the constructor.
 */
export class EventModel extends BaseModel<
  typeof Event,
  CreateEventInput,
  EventEntity,
  UpdateEventInput
> {
  /** Drizzle table */
  get table() {
    return Event
  }
}
