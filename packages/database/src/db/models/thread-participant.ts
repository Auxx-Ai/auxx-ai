// packages/database/src/db/models/thread-participant.ts
// ThreadParticipant model built on BaseModel (no org scope column)

import { ThreadParticipant } from '../schema/thread-participant'
import { BaseModel } from '../utils/base-model'

/** Selected ThreadParticipant entity type */
export type ThreadParticipantEntity = typeof ThreadParticipant.$inferSelect
/** Insertable ThreadParticipant input type */
export type CreateThreadParticipantInput = typeof ThreadParticipant.$inferInsert
/** Updatable ThreadParticipant input type */
export type UpdateThreadParticipantInput = Partial<CreateThreadParticipantInput>

/**
 * ThreadParticipantModel encapsulates CRUD for the ThreadParticipant table.
 */
export class ThreadParticipantModel extends BaseModel<
  typeof ThreadParticipant,
  CreateThreadParticipantInput,
  ThreadParticipantEntity,
  UpdateThreadParticipantInput
> {
  get table() {
    return ThreadParticipant
  }
}
