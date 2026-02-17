// packages/database/src/db/models/participant.ts
// Participant model built on BaseModel (org-scoped)

import { and, ilike, or, type SQL } from 'drizzle-orm'
import { Participant } from '../schema/participant'
import { BaseModel } from '../utils/base-model'
import { Result, type TypedResult } from '../utils/result'

/** Selected Participant entity type */
export type ParticipantEntity = typeof Participant.$inferSelect
/** Insertable Participant input type */
export type CreateParticipantInput = typeof Participant.$inferInsert
/** Updatable Participant input type */
export type UpdateParticipantInput = Partial<CreateParticipantInput>

/**
 * ParticipantModel encapsulates CRUD for the Participant table.
 * Org-scoped via organizationId when provided to the constructor.
 */
export class ParticipantModel extends BaseModel<
  typeof Participant,
  CreateParticipantInput,
  ParticipantEntity,
  UpdateParticipantInput
> {
  /** Drizzle table */
  get table() {
    return Participant
  }

  /** Suggest participants by identifier/name/displayName */
  async listSuggestions(
    q?: string,
    limit: number = 10
  ): Promise<TypedResult<ParticipantEntity[], Error>> {
    try {
      this.requireOrgIfScoped()
      const whereParts: SQL<unknown>[] = []
      if (this.scopeFilter) whereParts.push(this.scopeFilter)
      if (q) {
        const needle = `%${q}%`
        whereParts.push(
          or(
            ilike(Participant.identifier as any, needle),
            ilike(Participant.name as any, needle),
            ilike(Participant.displayName as any, needle)
          ) as any
        )
      }
      let qy = this.db.select().from(Participant).limit(limit).$dynamic()
      if (whereParts.length === 1) qy = qy.where(whereParts[0])
      else if (whereParts.length > 1) qy = qy.where(and(...whereParts))
      const rows = (await qy) as any[]
      return Result.ok(rows as any)
    } catch (error: any) {
      return Result.error(error)
    }
  }
}
