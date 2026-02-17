// packages/database/src/db/schema/ticket-reply.ts
// Drizzle table: ticketReply

import { createId } from '@paralleldrive/cuid2'
import { type AnyPgColumn, boolean, index, pgTable, text, timestamp, uniqueIndex } from './_shared'
import { EntityInstance } from './entity-instance'
import { Organization } from './organization'
import { User } from './user'

/** Drizzle table for ticketReply */
export const TicketReply = pgTable(
  'TicketReply',
  {
    id: text()
      .$defaultFn(() => createId())
      .primaryKey()
      .notNull(),
    content: text().notNull(),
    createdAt: timestamp({ precision: 3 }).defaultNow().notNull(),
    messageId: text(),
    senderEmail: text(),
    isFromCustomer: boolean().default(false).notNull(),
    entityInstanceId: text()
      .notNull()
      .references((): AnyPgColumn => EntityInstance.id, {
        onUpdate: 'cascade',
        onDelete: 'cascade',
      }),
    organizationId: text()
      .notNull()
      .references((): AnyPgColumn => Organization.id, { onUpdate: 'cascade', onDelete: 'cascade' }),
    recipientEmail: text(),
    ccEmails: text().array().default(['RAY']),
    createdById: text().references((): AnyPgColumn => User.id, {
      onUpdate: 'cascade',
      onDelete: 'set null',
    }),
    inReplyTo: text(),
    references: text(),
  },
  (table) => [
    index('TicketReply_messageId_idx').using('btree', table.messageId.asc().nullsLast()),
    uniqueIndex('TicketReply_messageId_key').using('btree', table.messageId.asc().nullsLast()),
    index('TicketReply_entityInstanceId_idx').using(
      'btree',
      table.entityInstanceId.asc().nullsLast()
    ),
    index('TicketReply_organizationId_idx').using('btree', table.organizationId.asc().nullsLast()),
  ]
)
