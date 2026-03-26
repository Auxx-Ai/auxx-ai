// packages/lib/src/mail-schedule/scheduled-message.ts

import { type Database, schema } from '@auxx/database'
import { createScopedLogger } from '@auxx/logger'
import { and, eq } from 'drizzle-orm'

const logger = createScopedLogger('scheduled-message')

type ScheduledMessageInsert = typeof schema.ScheduledMessage.$inferInsert
type ScheduledMessageSelect = typeof schema.ScheduledMessage.$inferSelect
type ScheduledMessageStatus = ScheduledMessageSelect['status']

export type { ScheduledMessageSelect, ScheduledMessageStatus }

/** Create a new scheduled message record. */
export async function createScheduledMessage(
  db: Database,
  data: Omit<ScheduledMessageInsert, 'id' | 'createdAt' | 'updatedAt'>
): Promise<ScheduledMessageSelect> {
  const [row] = await db.insert(schema.ScheduledMessage).values(data).returning()
  logger.info('Created scheduled message', { id: row.id, scheduledAt: row.scheduledAt })
  return row
}

/** Fetch a scheduled message by ID, scoped to organization. */
export async function findScheduledMessageById(
  db: Database,
  id: string,
  organizationId: string
): Promise<ScheduledMessageSelect | undefined> {
  const [row] = await db
    .select()
    .from(schema.ScheduledMessage)
    .where(
      and(
        eq(schema.ScheduledMessage.id, id),
        eq(schema.ScheduledMessage.organizationId, organizationId)
      )
    )
    .limit(1)
  return row
}

/** Check if a draft already has a PENDING scheduled message. */
export async function findPendingByDraftId(
  db: Database,
  draftId: string,
  organizationId: string
): Promise<ScheduledMessageSelect | undefined> {
  const [row] = await db
    .select()
    .from(schema.ScheduledMessage)
    .where(
      and(
        eq(schema.ScheduledMessage.draftId, draftId),
        eq(schema.ScheduledMessage.organizationId, organizationId),
        eq(schema.ScheduledMessage.status, 'PENDING')
      )
    )
    .limit(1)
  return row
}

/** Update the status of a scheduled message with optional extra fields. */
export async function updateScheduledMessageStatus(
  db: Database,
  id: string,
  status: ScheduledMessageStatus,
  extra?: { failureReason?: string; attempts?: number; jobId?: string }
): Promise<ScheduledMessageSelect | undefined> {
  const [row] = await db
    .update(schema.ScheduledMessage)
    .set({ status, ...extra })
    .where(eq(schema.ScheduledMessage.id, id))
    .returning()
  return row
}

/** Cancel a scheduled message. Only works if current status is PENDING. */
export async function cancelScheduledMessage(
  db: Database,
  id: string,
  organizationId: string
): Promise<ScheduledMessageSelect | undefined> {
  const [row] = await db
    .update(schema.ScheduledMessage)
    .set({ status: 'CANCELLED' })
    .where(
      and(
        eq(schema.ScheduledMessage.id, id),
        eq(schema.ScheduledMessage.organizationId, organizationId),
        eq(schema.ScheduledMessage.status, 'PENDING')
      )
    )
    .returning()
  return row
}
