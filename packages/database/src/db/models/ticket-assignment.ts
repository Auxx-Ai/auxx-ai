// packages/database/src/db/models/ticket-assignment.ts
// TicketAssignment model built on BaseModel (no org scope column)

import { and, eq, type SQL } from 'drizzle-orm'
import { TicketAssignment } from '../schema/ticket-assignment'
import { BaseModel } from '../utils/base-model'
import { Result, type TypedResult } from '../utils/result'

/** Selected TicketAssignment entity type */
export type TicketAssignmentEntity = typeof TicketAssignment.$inferSelect
/** Insertable TicketAssignment input type */
export type CreateTicketAssignmentInput = typeof TicketAssignment.$inferInsert
/** Updatable TicketAssignment input type */
export type UpdateTicketAssignmentInput = Partial<CreateTicketAssignmentInput>

/**
 * TicketAssignmentModel encapsulates CRUD for the TicketAssignment table.
 * No org scoping is applied by default.
 */
export class TicketAssignmentModel extends BaseModel<
  typeof TicketAssignment,
  CreateTicketAssignmentInput,
  TicketAssignmentEntity,
  UpdateTicketAssignmentInput
> {
  /** Drizzle table */
  get table() {
    return TicketAssignment
  }

  /** Find assignments by ticket and agent, optionally only active */
  async findByTicketAndAgent(
    ticketId: string,
    agentId: string,
    opts: { onlyActive?: boolean } = {}
  ): Promise<TypedResult<TicketAssignmentEntity[], Error>> {
    try {
      const whereParts: SQL<unknown>[] = [
        eq(TicketAssignment.ticketId, ticketId as any),
        eq(TicketAssignment.agentId, agentId as any),
      ]
      if (opts.onlyActive) whereParts.push(eq(TicketAssignment.isActive, true as any))
      let q = this.db.select().from(TicketAssignment).$dynamic()
      q = q.where(and(...whereParts))
      const rows = await q
      return Result.ok(rows as TicketAssignmentEntity[])
    } catch (error: any) {
      return Result.error(error)
    }
  }
}
