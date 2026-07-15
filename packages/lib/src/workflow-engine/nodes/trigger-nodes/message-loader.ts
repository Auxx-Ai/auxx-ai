// packages/lib/src/workflow-engine/nodes/trigger-nodes/message-loader.ts

import { type Database, database as defaultDb, schema } from '@auxx/database'
import { and, eq } from 'drizzle-orm'
import type { ProcessedMessage } from '../../types/message'

/**
 * Load a single message with the relations `ProcessedMessage` needs for
 * workflow trigger execution: `from`/`replyTo` participants, `thread`,
 * `organization`, and every `MessageParticipant` join row hydrated with its
 * `Participant` (so the `message-received` trigger node can derive
 * `message.to` without a second query).
 *
 * Used by the `message:received` dispatcher (`trigger-message-workflows.ts`)
 * to hydrate the trigger payload once per event, shared across every matching
 * workflow's run. Returns `null` when the message no longer exists or does
 * not belong to `organizationId`.
 */
export async function loadProcessedMessage(
  messageId: string,
  organizationId: string,
  db: Database = defaultDb
): Promise<ProcessedMessage | null> {
  const message = await db.query.Message.findFirst({
    where: and(eq(schema.Message.id, messageId), eq(schema.Message.organizationId, organizationId)),
    with: {
      from: true,
      replyTo: true,
      thread: true,
      organization: true,
      participants: { with: { participant: true } },
    },
  })

  return (message as ProcessedMessage | undefined) ?? null
}
