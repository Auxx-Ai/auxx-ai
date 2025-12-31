// packages/lib/src/providers/google/webhooks/setup-webhook.ts
import { gmail_v1 as GmailV1 } from 'googleapis'
import { database as db, schema } from '@auxx/database'
import { eq } from 'drizzle-orm'
import { env } from '@auxx/config/server'
import { createScopedLogger } from '@auxx/logger'
import type { GoogleIntegration } from '../google-oauth'
import { Common } from 'googleapis'

type GaxiosError = Common.GaxiosError

const logger = createScopedLogger('google-webhook-setup')

/**
 * Sets up Gmail push notifications using the watch API.
 * Configures Gmail to send notifications to Google Pub/Sub topic when new messages arrive.
 */
export async function setupWebhook(params: {
  gmail: GmailV1.Gmail
  integrationId: string
  integration: GoogleIntegration
}): Promise<void> {
  const { gmail, integrationId, integration } = params

  const topicName = `projects/${env.GOOGLE_PROJECT_ID}/topics/${env.GOOGLE_PUBSUB_TOPIC}`

  if (!env.GOOGLE_PROJECT_ID || !env.GOOGLE_PUBSUB_TOPIC) {
    logger.error(
      'Google Project ID or Pub/Sub Topic Name not configured in environment. Cannot set up webhook.'
    )
    throw new Error('Webhook configuration missing.')
  }

  try {
    logger.info('Attempting to set up Gmail watch on topic:', {
      topicName,
      integrationId,
    })

    const response = await gmail.users.watch({
      userId: 'me',
      requestBody: {
        topicName: topicName,
        labelIds: ['INBOX'], // Watch only the inbox
        labelFilterBehavior: 'INCLUDE',
      },
    })

    logger.info('Gmail watch setup successful:', {
      response: response.data,
      integrationId,
    })

    // Store historyId and expiration from watch response
    if (response.data.historyId) {
      await db
        .update(schema.Integration)
        .set({
          lastHistoryId: response.data.historyId,
          // Store watch expiration if needed for renewal logic
          metadata: {
            ...((integration as any)?.metadata || {}),
            watchExpiration: response.data.expiration,
          },
        })
        .where(eq(schema.Integration.id, integrationId))
        .catch((err) => logger.error('Failed to update historyId after watch setup', { err }))

      // Update local cache if integration reference is available
      if (integration) {
        integration.lastHistoryId = response.data.historyId
      }
    }
  } catch (error: any) {
    const gaxiosError = error as GaxiosError

    // Check if this is an authentication error that needs special handling
    const isAuthError =
      gaxiosError.response?.status === 401 ||
      gaxiosError.message?.includes('invalid_grant') ||
      gaxiosError.message?.includes('unauthorized') ||
      gaxiosError.response?.data?.error === 'invalid_grant'

    if (isAuthError) {
      // Use standardized error handling for authentication errors
      const { AuthErrorHandler } = await import('../../auth-error-handler')
      const errorHandler = new AuthErrorHandler('google', integrationId)
      const errorDetails = await errorHandler.handleAuthError(error, 'watch_setup')
      logger.error('Authentication error setting up Gmail watch:', {
        message: errorDetails.message,
        integrationId,
      })
    } else {
      // Handle non-authentication errors with original logic
      logger.error('Error setting up Gmail watch:', {
        message: gaxiosError.message,
        status: gaxiosError.response?.status,
        data: gaxiosError.response?.data,
        integrationId,
      })
    }

    throw new Error(`Failed to set up Gmail watch: ${gaxiosError.message}`)
  }
}
