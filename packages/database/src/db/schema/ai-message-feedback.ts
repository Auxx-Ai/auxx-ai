// packages/database/src/db/schema/ai-message-feedback.ts

import { createId } from '@paralleldrive/cuid2'
import { type AnyPgColumn, boolean, index, pgTable, text, timestamp, uniqueIndex } from './_shared'
import { AiAgentSession } from './ai-agent-session'
import { Organization } from './organization'
import { User } from './user'

export const AiMessageFeedback = pgTable(
  'AiMessageFeedback',
  {
    id: text()
      .$defaultFn(() => createId())
      .primaryKey()
      .notNull(),
    createdAt: timestamp({ precision: 3 }).defaultNow().notNull(),
    /** The session this message belongs to */
    sessionId: text()
      .notNull()
      .references((): AnyPgColumn => AiAgentSession.id, {
        onUpdate: 'cascade',
        onDelete: 'cascade',
      }),
    /** The KopilotMessage.id within the session's JSONB messages array */
    messageId: text().notNull(),
    /** true = thumbs up, false = thumbs down */
    isPositive: boolean().notNull(),
    organizationId: text()
      .notNull()
      .references((): AnyPgColumn => Organization.id, {
        onUpdate: 'cascade',
        onDelete: 'cascade',
      }),
    userId: text()
      .notNull()
      .references((): AnyPgColumn => User.id, {
        onUpdate: 'cascade',
        onDelete: 'cascade',
      }),
  },
  (table) => [
    // One rating per user per message (upsert target)
    uniqueIndex('AiMessageFeedback_sessionId_messageId_userId_key').using(
      'btree',
      table.sessionId.asc().nullsLast(),
      table.messageId.asc().nullsLast(),
      table.userId.asc().nullsLast()
    ),
    index('AiMessageFeedback_organizationId_idx').using(
      'btree',
      table.organizationId.asc().nullsLast()
    ),
    index('AiMessageFeedback_isPositive_idx').using('btree', table.isPositive.asc().nullsLast()),
  ]
)

export type AiMessageFeedbackEntity = typeof AiMessageFeedback.$inferSelect
export type AiMessageFeedbackInsert = typeof AiMessageFeedback.$inferInsert
