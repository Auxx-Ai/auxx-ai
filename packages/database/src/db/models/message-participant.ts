// packages/database/src/db/models/message-participant.ts
// MessageParticipant model built on BaseModel (no org scope column)

import { MessageParticipant } from '../schema/message-participant'
import { BaseModel } from '../utils/base-model'

/** Selected MessageParticipant entity type */
export type MessageParticipantEntity = typeof MessageParticipant.$inferSelect
/** Insertable MessageParticipant input type */
export type CreateMessageParticipantInput = typeof MessageParticipant.$inferInsert
/** Updatable MessageParticipant input type */
export type UpdateMessageParticipantInput = Partial<CreateMessageParticipantInput>

/**
 * MessageParticipantModel encapsulates CRUD for the MessageParticipant table.
 * No org scoping is applied by default.
 */
export class MessageParticipantModel extends BaseModel<
  typeof MessageParticipant,
  CreateMessageParticipantInput,
  MessageParticipantEntity,
  UpdateMessageParticipantInput
> {
  /** Drizzle table */
  get table() {
    return MessageParticipant
  }
}
