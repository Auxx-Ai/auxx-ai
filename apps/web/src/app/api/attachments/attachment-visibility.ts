// apps/web/src/app/api/attachments/attachment-visibility.ts

import { database, schema } from '@auxx/database'
import { getCachedUserMailVisibility } from '@auxx/lib/cache'
import { getThreadLens } from '@auxx/lib/permissions/visibility'
import { and, eq } from 'drizzle-orm'

/**
 * Mail-permissions gate for the attachment content routes: attachments on a
 * MESSAGE are `full`-tier (§7) — the caller must hold `full` lens on the
 * parent thread. Attachments on other entities pass through to the routes'
 * existing authorization. A missing attachment/message also returns false
 * (invisible ≍ nonexistent).
 */
export async function canViewAttachment(
  attachmentId: string,
  userId: string,
  organizationId: string
): Promise<boolean> {
  const [attachment] = await database
    .select({
      entityType: schema.Attachment.entityType,
      entityId: schema.Attachment.entityId,
    })
    .from(schema.Attachment)
    .where(
      and(
        eq(schema.Attachment.id, attachmentId),
        eq(schema.Attachment.organizationId, organizationId)
      )
    )
    .limit(1)
  if (!attachment) return false
  if (attachment.entityType !== 'MESSAGE') return true

  const [message] = await database
    .select({ threadId: schema.Message.threadId })
    .from(schema.Message)
    .where(
      and(
        eq(schema.Message.id, attachment.entityId),
        eq(schema.Message.organizationId, organizationId)
      )
    )
    .limit(1)
  if (!message) return false

  const viewer = await getCachedUserMailVisibility(userId, organizationId)
  return (await getThreadLens(database, organizationId, viewer, message.threadId)) === 'full'
}
