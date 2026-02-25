// packages/database/src/db/schema/message-participant.ts
// Drizzle table: messageParticipant

import { createId } from '@paralleldrive/cuid2'
import {
  type AnyPgColumn,
  index,
  participantRole,
  pgTable,
  text,
  timestamp,
  uniqueIndex,
} from './_shared'

import { Message } from './message'
import { Participant } from './participant'

/** Drizzle table for messageParticipant */
export const MessageParticipant = pgTable(
  'MessageParticipant',
  {
    id: text()
      .$defaultFn(() => createId())
      .primaryKey()
      .notNull(),
    role: participantRole().notNull(),
    messageId: text()
      .notNull()
      .references((): AnyPgColumn => Message.id, { onUpdate: 'cascade', onDelete: 'cascade' }),
    participantId: text()
      .notNull()
      .references((): AnyPgColumn => Participant.id, { onUpdate: 'cascade', onDelete: 'cascade' }),
    entityInstanceId: text(),
    createdAt: timestamp({ precision: 3 }).defaultNow().notNull(),
  },
  (table) => [
    index('MessageParticipant_messageId_idx').using('btree', table.messageId.asc().nullsLast()),
    uniqueIndex('MessageParticipant_messageId_participantId_role_key').using(
      'btree',
      table.messageId.asc().nullsLast(),
      table.participantId.asc().nullsLast(),
      table.role.asc().nullsLast()
    ),
    index('MessageParticipant_participantId_idx').using(
      'btree',
      table.participantId.asc().nullsLast()
    ),
    index('MessageParticipant_role_idx').using('btree', table.role.asc().nullsLast()),
    index('contact_history_idx').using(
      'btree',
      table.entityInstanceId.asc().nullsLast(),
      table.createdAt.asc().nullsLast()
    ),
    index('participant_lookup_idx').using(
      'btree',
      table.messageId.asc().nullsLast(),
      table.entityInstanceId.asc().nullsLast()
    ),
  ]
)

/** Selected MessageParticipant entity type */
export type MessageParticipantEntity = typeof MessageParticipant.$inferSelect
