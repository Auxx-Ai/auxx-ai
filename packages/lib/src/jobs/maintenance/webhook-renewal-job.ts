// packages/lib/src/jobs/maintenance/webhook-renewal-job.ts

import { database as db, schema } from '@auxx/database'
import { createScopedLogger } from '@auxx/logger'
import { and, eq, isNull } from 'drizzle-orm'
import { ProviderRegistryService } from '../../providers/provider-registry-service'
import { providerWebhookCallbackUrl } from '../../providers/webhook-callback-base'
import type { JobContext } from '../types'

const logger = createScopedLogger('webhook-renewal-job')

/** Webhook renewal job payload */
export interface WebhookRenewalJobData {
  integrationId: string
  organizationId: string
  provider: 'google' | 'outlook'
}

/** Webhook renewal job result */
interface WebhookRenewalJobResult {
  success: boolean
  webhookRenewed: boolean
  errors: string[]
}

/**
 * Webhook Renewal Job
 *
 * Re-arms the Gmail `watch` / Microsoft Graph subscription for a single channel. Token refresh
 * is no longer this job's concern — it runs through the unified connection layer (lazy via
 * `getChannelAccessToken` + proactively via `oauth2-token-refresh-scanner-job`'s integration
 * pass). The provider's `setupWebhook` resolves a fresh token from the resolver on its own.
 */
export const webhookRenewalJob = async (
  ctx: JobContext<WebhookRenewalJobData>
): Promise<WebhookRenewalJobResult> => {
  const job = ctx.job
  const { integrationId, organizationId, provider } = job.data

  logger.info('Starting webhook renewal', {
    integrationId,
    provider,
    jobId: job.id,
  })

  const result: WebhookRenewalJobResult = {
    success: false,
    webhookRenewed: false,
    errors: [],
  }

  try {
    // Verify channel still exists and is enabled
    const [integration] = await db
      .select()
      .from(schema.Integration)
      .where(and(eq(schema.Integration.id, integrationId), isNull(schema.Integration.deletedAt)))
      .limit(1)

    if (!integration) {
      logger.warn('Channel not found', { integrationId })
      return { ...result, errors: ['Channel not found'] }
    }

    if (!integration.enabled) {
      logger.warn('Channel is disabled, skipping webhook renewal', { integrationId })
      return { ...result, errors: ['Channel disabled'] }
    }

    try {
      const providerRegistry = new ProviderRegistryService(organizationId)
      const emailProvider = await providerRegistry.getProvider(integrationId)

      // Build callback URL (same helper as WebhookManagerService, NGROK_URL-aware in dev).
      // Google uses the Pub/Sub topic from env and ignores callbackUrl; Outlook uses it for
      // the Graph subscription.
      const callbackUrl = providerWebhookCallbackUrl(provider)

      await emailProvider.setupWebhook(callbackUrl)
      result.webhookRenewed = true
      logger.info('Successfully renewed channel webhook', { integrationId, provider })
    } catch (error: any) {
      result.errors.push(`Webhook renewal failed: ${error.message}`)
      logger.error('Failed to renew webhook', {
        integrationId,
        provider,
        error: error.message,
      })
    }

    result.success = result.errors.length === 0

    logger.info('Webhook renewal completed', {
      integrationId,
      result,
      jobId: job.id,
    })

    return result
  } catch (error) {
    logger.error('Webhook renewal job failed', {
      integrationId,
      error: error instanceof Error ? error.message : String(error),
      jobId: job.id,
    })
    throw error
  }
}
