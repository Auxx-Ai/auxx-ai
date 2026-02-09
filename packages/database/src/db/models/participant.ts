// packages/database/src/db/models/participant.ts
// Participant model built on BaseModel (org-scoped)

import { and, eq, ilike, or, type SQL } from 'drizzle-orm'
import { Participant } from '../schema/participant'
import { Contact } from '../schema/contact'
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

  /** Suggest participants by identifier/name/displayName or contact fields */
  async listSuggestions(q?: string, limit: number = 10): Promise<
    TypedResult<
      Array<
        ParticipantEntity & {
          contact?: Pick<typeof Contact.$inferSelect, 'id' | 'firstName' | 'lastName' | 'email'>
        }
      >,
      Error
    >
  > {
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
            ilike(Participant.displayName as any, needle),
            ilike(Contact.firstName as any, needle),
            ilike(Contact.lastName as any, needle),
            ilike(Contact.email as any, needle)
          ) as any
        )
      }
      let qy = this.db
        .select({
          id: Participant.id,
          identifier: Participant.identifier,
          identifierType: Participant.identifierType,
          name: Participant.name,
          displayName: Participant.displayName,
          contact: {
            id: Contact.id,
            firstName: Contact.firstName,
            lastName: Contact.lastName,
            email: Contact.email,
          },
        })
        .from(Participant)
        .leftJoin(Contact, eq(Contact.id, Participant.entityInstanceId))
        .limit(limit)
        .$dynamic()
      if (whereParts.length === 1) qy = qy.where(whereParts[0])
      else if (whereParts.length > 1) qy = qy.where(and(...whereParts))
      const rows = (await qy) as any[]
      return Result.ok(rows as any)
    } catch (error: any) {
      return Result.error(error)
    }
  }
}
