// packages/database/src/db/schema/scheduled-message.ts
// Drizzle table: scheduled_message

import { createId } from '@paralleldrive/cuid2'
import {
  type AnyPgColumn,
  index,
  integer,
  jsonb,
  pgTable,
  scheduledMessageStatus,
  text,
  timestamp,
} from './_shared'
import { Draft } from './draft'
import { Integration } from './integration'
import { Organization } from './organization'
import { Thread } from './thread'
import { User } from './user'

/**
 * Scheduled messages waiting to be sent at a future time.
 * Created when a user schedules an email — stores the full send payload
 * and is processed by a BullMQ delayed job at the scheduled time.
 */
export const ScheduledMessage = pgTable(
  'ScheduledMessage',
  {
    /** Unique identifier using cuid2 */
    id: text()
      .$defaultFn(() => createId())
      .primaryKey()
      .notNull(),

    /** Organization this scheduled message belongs to */
    organizationId: text()
      .notNull()
      .references((): AnyPgColumn => Organization.id, { onUpdate: 'cascade', onDelete: 'cascade' }),

    /** Draft this scheduled message was created from (nullable — draft may be deleted after scheduling) */
    draftId: text().references((): AnyPgColumn => Draft.id, {
      onUpdate: 'cascade',
      onDelete: 'set null',
    }),

    /** Integration/inbox used for sending */
    integrationId: text()
      .notNull()
      .references((): AnyPgColumn => Integration.id, { onUpdate: 'cascade', onDelete: 'cascade' }),

    /** Thread this message belongs to (nullable — new threads) */
    threadId: text().references((): AnyPgColumn => Thread.id, {
      onUpdate: 'cascade',
      onDelete: 'cascade',
    }),

    /** User who scheduled this message */
    createdById: text()
      .notNull()
      .references((): AnyPgColumn => User.id, { onUpdate: 'cascade', onDelete: 'cascade' }),

    /** When to send the message */
    scheduledAt: timestamp({ precision: 3 }).notNull(),

    /** Current status of the scheduled message */
    status: scheduledMessageStatus().notNull().default('PENDING'),

    /** BullMQ job ID for cancellation */
    jobId: text(),

    /** Full SendMessageInput snapshot — everything needed to send at the scheduled time */
    sendPayload: jsonb().notNull(),

    /** Reason for failure (populated when status is FAILED) */
    failureReason: text(),

    /** Number of send attempts */
    attempts: integer().notNull().default(0),

    /** When the scheduled message was created */
    createdAt: timestamp({ precision: 3 }).defaultNow().notNull(),

    /** When the scheduled message was last updated (auto-updates on change) */
    updatedAt: timestamp({ precision: 3 })
      .defaultNow()
      .notNull()
      .$onUpdate(() => new Date()),
  },
  (table) => [
    // Scanner query: find pending messages to process by scheduled time
    index('ScheduledMessage_orgId_status_scheduledAt_idx').using(
      'btree',
      table.organizationId.asc().nullsLast(),
      table.status.asc().nullsLast(),
      table.scheduledAt.asc().nullsLast()
    ),

    // Lookup by draft: check if a draft already has a pending schedule
    index('ScheduledMessage_draftId_idx').using('btree', table.draftId.asc().nullsLast()),
  ]
)
