// packages/database/src/db/models/ticket-relation.ts
// TicketRelation model built on BaseModel (no org scope column)

import { TicketRelation } from '../schema/ticket-relation'
import { BaseModel } from '../utils/base-model'

/** Selected TicketRelation entity type */
export type TicketRelationEntity = typeof TicketRelation.$inferSelect
/** Insertable TicketRelation input type */
export type CreateTicketRelationInput = typeof TicketRelation.$inferInsert
/** Updatable TicketRelation input type */
export type UpdateTicketRelationInput = Partial<CreateTicketRelationInput>

/**
 * TicketRelationModel encapsulates CRUD for the TicketRelation table.
 * No org scoping is applied by default.
 */
export class TicketRelationModel extends BaseModel<
  typeof TicketRelation,
  CreateTicketRelationInput,
  TicketRelationEntity,
  UpdateTicketRelationInput
> {
  /** Drizzle table */
  get table() {
    return TicketRelation
  }
}
