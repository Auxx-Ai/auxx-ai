// packages/database/src/db/models/ticket-view.ts
// TicketView model built on BaseModel (org-scoped)

import { TicketView } from '../schema/ticket-view'
import { BaseModel } from '../utils/base-model'

/** Selected TicketView entity type */
export type TicketViewEntity = typeof TicketView.$inferSelect
/** Insertable TicketView input type */
export type CreateTicketViewInput = typeof TicketView.$inferInsert
/** Updatable TicketView input type */
export type UpdateTicketViewInput = Partial<CreateTicketViewInput>

/**
 * TicketViewModel encapsulates CRUD for the TicketView table.
 * Org-scoped via organizationId when provided to the constructor.
 */
export class TicketViewModel extends BaseModel<
  typeof TicketView,
  CreateTicketViewInput,
  TicketViewEntity,
  UpdateTicketViewInput
> {
  /** Drizzle table */
  get table() {
    return TicketView
  }
}
