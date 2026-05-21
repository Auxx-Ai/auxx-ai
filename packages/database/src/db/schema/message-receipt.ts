// packages/database/src/db/schema/message-receipt.ts
// Drizzle table: messageReceipt — per-recipient delivery/read tracking for a Message.

import { createId } from '@paralleldrive/cuid2'
import { type AnyPgColumn, index, pgTable, text, timestamp, uniqueIndex } from './_shared'

import { Message } from './message'
import { Participant } from './participant'

/** Drizzle table for messageReceipt */
export const MessageReceipt = pgTable(
  'MessageReceipt',
  {
    id: text()
      .$defaultFn(() => createId())
      .primaryKey()
      .notNull(),
    messageId: text()
      .notNull()
      .references((): AnyPgColumn => Message.id, { onUpdate: 'cascade', onDelete: 'cascade' }),
    recipientParticipantId: text()
      .notNull()
      .references((): AnyPgColumn => Participant.id, {
        onUpdate: 'cascade',
        onDelete: 'cascade',
      }),
    deliveredAt: timestamp({ precision: 3 }),
    readAt: timestamp({ precision: 3 }),
    createdAt: timestamp({ precision: 3 }).defaultNow().notNull(),
    updatedAt: timestamp({ precision: 3 }).notNull(),
  },
  (table) => [
    uniqueIndex('MessageReceipt_message_recipient_key').on(
      table.messageId,
      table.recipientParticipantId
    ),
    index('MessageReceipt_messageId_idx').on(table.messageId),
  ]
)

export type MessageReceiptEntity = typeof MessageReceipt.$inferSelect
export type CreateMessageReceiptInput = typeof MessageReceipt.$inferInsert
export type UpdateMessageReceiptInput = Partial<CreateMessageReceiptInput>
