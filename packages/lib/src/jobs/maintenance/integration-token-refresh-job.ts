// packages/lib/src/jobs/maintenance/integration-token-refresh-job.ts

import { configService } from '@auxx/credentials'
import { database as db, schema } from '@auxx/database'
import { createScopedLogger } from '@auxx/logger'
import type { Job } from 'bullmq'
import { eq } from 'drizzle-orm'
import { GoogleOAuthService } from '../../providers/google/google-oauth'
import { OutlookOAuthService } from '../../providers/outlook/outlook-oauth'
import { ProviderRegistryService } from '../../providers/provider-registry-service'

const logger = createScopedLogger('integration-token-refresh-job')

/** Refresh job payload */
export interface IntegrationTokenRefreshJobData {
  integrationId: string
  organizationId: string
  provider: 'google' | 'outlook'
  refreshToken: boolean
  renewWebhook: boolean
}

/** Refresh job result */
interface RefreshJobResult {
  success: boolean
  tokenRefreshed: boolean
  webhookRenewed: boolean
  errors: string[]
}

/**
 * Integration Token Refresh Job
 *
 * Refreshes OAuth tokens and/or renews webhooks for a single integration.
 */
export const integrationTokenRefreshJob = async (
  job: Job<IntegrationTokenRefreshJobData>
): Promise<RefreshJobResult> => {
  const { integrationId, organizationId, provider, refreshToken, renewWebhook } = job.data

  logger.info('Starting integration token refresh', {
    integrationId,
    provider,
    refreshToken,
    renewWebhook,
    jobId: job.id,
  })

  const result: RefreshJobResult = {
    success: false,
    tokenRefreshed: false,
    webhookRenewed: false,
    errors: [],
  }

  try {
    // Verify integration still exists and is enabled
    const [integration] = await db
      .select()
      .from(schema.Integration)
      .where(eq(schema.Integration.id, integrationId))
      .limit(1)

    if (!integration) {
      logger.warn('Integration not found', { integrationId })
      return { ...result, errors: ['Integration not found'] }
    }

    if (!integration.enabled) {
      logger.warn('Integration is disabled, skipping refresh', { integrationId })
      return { ...result, errors: ['Integration disabled'] }
    }

    // Refresh access token
    if (refreshToken) {
      try {
        if (provider === 'google') {
          const googleOAuth = GoogleOAuthService.getInstance()
          await googleOAuth.refreshTokens(integrationId)
          result.tokenRefreshed = true
          logger.info('Successfully refreshed Google token', { integrationId })
        } else if (provider === 'outlook') {
          const outlookOAuth = OutlookOAuthService.getInstance()
          await outlookOAuth.refreshTokens(integrationId)
          result.tokenRefreshed = true
          logger.info('Successfully refreshed Outlook token', { integrationId })
        }

        // Update auth status to healthy
        await db
          .update(schema.Integration)
          .set({
            authStatus: 'AUTHENTICATED',
            updatedAt: new Date(),
          })
          .where(eq(schema.Integration.id, integrationId))
      } catch (error: any) {
        result.errors.push(`Token refresh failed: ${error.message}`)
        logger.error('Failed to refresh token', {
          integrationId,
          provider,
          error: error.message,
        })
        // Don't throw - continue to try webhook renewal if needed
      }
    }

    // Renew webhook/watch
    if (renewWebhook) {
      try {
        const providerRegistry = new ProviderRegistryService(organizationId)
        const emailProvider = await providerRegistry.getProvider(integrationId)

        // Build callback URL (same logic as WebhookManagerService)
        const baseUrl = configService.get<string>('NEXT_PUBLIC_APP_URL') || 'http://localhost:3000'
        const callbackUrl = `${baseUrl}/api/${provider}/webhook`

        if (provider === 'google') {
          // Google uses Pub/Sub topic from env vars, callbackUrl is ignored
          await emailProvider.setupWebhook(callbackUrl)
          result.webhookRenewed = true
          logger.info('Successfully renewed Gmail watch', { integrationId })
        } else if (provider === 'outlook') {
          // Outlook uses the callback URL for Microsoft Graph subscription
          await emailProvider.setupWebhook(callbackUrl)
          result.webhookRenewed = true
          logger.info('Successfully renewed Outlook subscription', { integrationId })
        }
      } catch (error: any) {
        result.errors.push(`Webhook renewal failed: ${error.message}`)
        logger.error('Failed to renew webhook', {
          integrationId,
          provider,
          error: error.message,
        })
      }
    }

    result.success = result.errors.length === 0

    logger.info('Integration token refresh completed', {
      integrationId,
      result,
      jobId: job.id,
    })

    return result
  } catch (error) {
    logger.error('Integration token refresh job failed', {
      integrationId,
      error: error instanceof Error ? error.message : String(error),
      jobId: job.id,
    })
    throw error
  }
}
