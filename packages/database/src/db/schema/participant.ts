// packages/database/src/db/schema/participant.ts

import { createId } from '@paralleldrive/cuid2'
import {
  type AnyPgColumn,
  boolean,
  identifierType,
  index,
  pgTable,
  text,
  timestamp,
  uniqueIndex,
} from './_shared'

import { EntityInstance } from './entity-instance'
import { Organization } from './organization'

/** Drizzle table for participant */
export const Participant = pgTable(
  'Participant',
  {
    id: text()
      .$defaultFn(() => createId())
      .primaryKey()
      .notNull(),
    identifier: text().notNull(),
    identifierType: identifierType().notNull(),
    name: text(),
    displayName: text(),
    initials: text(),
    isSpammer: boolean().default(false).notNull(),
    /** Reference to EntityInstance (contact entity type) */
    entityInstanceId: text().references((): AnyPgColumn => EntityInstance.id, {
      onUpdate: 'cascade',
      onDelete: 'set null',
    }),
    organizationId: text()
      .notNull()
      .references((): AnyPgColumn => Organization.id, { onUpdate: 'cascade', onDelete: 'cascade' }),
    createdAt: timestamp({ precision: 3 }).defaultNow().notNull(),
    updatedAt: timestamp({ precision: 3 }).notNull(),
    firstInteractionDate: timestamp({ precision: 3 }),
    firstInteractionType: text(),
    hasReceivedMessage: boolean().default(false).notNull(),
    lastSentMessageAt: timestamp({ precision: 3 }),
  },
  (table) => [
    index('Participant_entityInstanceId_idx').using(
      'btree',
      table.entityInstanceId.asc().nullsLast()
    ),
    index('Participant_identifierType_idx').using('btree', table.identifierType.asc().nullsLast()),
    index('Participant_identifier_idx').using('btree', table.identifier.asc().nullsLast()),
    uniqueIndex('Participant_organizationId_identifier_identifierType_key').using(
      'btree',
      table.organizationId.asc().nullsLast(),
      table.identifier.asc().nullsLast(),
      table.identifierType.asc().nullsLast()
    ),
    index('Participant_organizationId_idx').using('btree', table.organizationId.asc().nullsLast()),
  ]
)

export type ParticipantEntity = typeof Participant.$inferSelect
export type CreateParticipantInput = typeof Participant.$inferInsert
export type UpdateParticipantInput = Partial<CreateParticipantInput>
