// packages/lib/src/providers/google/webhooks/remove-webhook.ts
import { gmail_v1 as GmailV1 } from 'googleapis'
import { database as db, schema } from '@auxx/database'
import { eq } from 'drizzle-orm'
import { createScopedLogger } from '@auxx/logger'
import { Common } from 'googleapis'

type GaxiosError = Common.GaxiosError

const logger = createScopedLogger('google-webhook-remove')

/**
 * Removes Gmail watch and stops push notifications.
 * Clears watch metadata from the database.
 */
export async function removeWebhook(params: {
  gmail: GmailV1.Gmail
  integrationId: string
}): Promise<void> {
  const { gmail, integrationId } = params

  try {
    await gmail.users.stop({ userId: 'me' })

    logger.info('Gmail watch stopped successfully', { integrationId })

    // Clear watch metadata from database
    await db
      .update(schema.Integration)
      .set({
        metadata: db.raw(`
          CASE
            WHEN metadata IS NOT NULL
            THEN jsonb_set(metadata, '{watchExpiration}', 'null'::jsonb)
            ELSE NULL
          END
        `),
      })
      .where(eq(schema.Integration.id, integrationId))
      .catch((err) => logger.error('Failed to clear watch metadata after stop', { err }))
  } catch (error: any) {
    const gaxiosError = error as GaxiosError

    // 404 means there's no active watch, which is fine
    if (gaxiosError.response?.status === 404) {
      logger.warn('No active Gmail watch found to stop.', { integrationId })
      return
    }

    logger.error('Error stopping Gmail watch:', {
      message: gaxiosError.message,
      status: gaxiosError.response?.status,
      data: gaxiosError.response?.data,
      integrationId,
    })

    // Don't throw during cleanup to avoid blocking other operations
  }
}
