// packages/database/src/db/models/ticket-note.ts
// TicketNote model built on BaseModel (no org scope column)

import { TicketNote } from '../schema/ticket-note'
import { BaseModel } from '../utils/base-model'

/** Selected TicketNote entity type */
export type TicketNoteEntity = typeof TicketNote.$inferSelect
/** Insertable TicketNote input type */
export type CreateTicketNoteInput = typeof TicketNote.$inferInsert
/** Updatable TicketNote input type */
export type UpdateTicketNoteInput = Partial<CreateTicketNoteInput>

/**
 * TicketNoteModel encapsulates CRUD for the TicketNote table.
 * No org scoping is applied by default.
 */
export class TicketNoteModel extends BaseModel<
  typeof TicketNote,
  CreateTicketNoteInput,
  TicketNoteEntity,
  UpdateTicketNoteInput
> {
  /** Drizzle table */
  get table() {
    return TicketNote
  }
}
