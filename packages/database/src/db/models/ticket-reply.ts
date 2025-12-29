// packages/database/src/db/models/ticket-reply.ts
// TicketReply model built on BaseModel (no org scope column)

import { TicketReply } from '../schema/ticket-reply'
import { BaseModel } from '../utils/base-model'

/** Selected TicketReply entity type */
export type TicketReplyEntity = typeof TicketReply.$inferSelect
/** Insertable TicketReply input type */
export type CreateTicketReplyInput = typeof TicketReply.$inferInsert
/** Updatable TicketReply input type */
export type UpdateTicketReplyInput = Partial<CreateTicketReplyInput>

/**
 * TicketReplyModel encapsulates CRUD for the TicketReply table.
 * No org scoping is applied by default.
 */
export class TicketReplyModel extends BaseModel<
  typeof TicketReply,
  CreateTicketReplyInput,
  TicketReplyEntity,
  UpdateTicketReplyInput
> {
  /** Drizzle table */
  get table() {
    return TicketReply
  }
}
