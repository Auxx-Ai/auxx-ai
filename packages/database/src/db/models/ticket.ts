// packages/database/src/db/models/ticket.ts
// Ticket model built on BaseModel (org-scoped)

import { Ticket } from '../schema/ticket'
import { BaseModel } from '../utils/base-model'

/** Selected Ticket entity type */
export type TicketEntity = typeof Ticket.$inferSelect
/** Insertable Ticket input type */
export type CreateTicketInput = typeof Ticket.$inferInsert
/** Updatable Ticket input type */
export type UpdateTicketInput = Partial<CreateTicketInput>

/**
 * TicketModel encapsulates CRUD for the Ticket table.
 * Org-scoped via organizationId when provided to the constructor.
 */
export class TicketModel extends BaseModel<
  typeof Ticket,
  CreateTicketInput,
  TicketEntity,
  UpdateTicketInput
> {
  /** Drizzle table */
  get table() {
    return Ticket
  }
}
