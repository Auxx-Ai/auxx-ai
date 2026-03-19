// packages/lib/src/events/handlers/publish-to-analytics-job.ts
// packages/lib/src/events/handlers/publish-to-analytics-job.ts
import { configService } from '@auxx/credentials'
import type { Job } from 'bullmq'
import { createScopedLogger } from '../../logger'
import { getPostHogClient } from '../../posthog/posthog-client'
import type { AuxxEvent } from '../types'

const logger = createScopedLogger('publish-to-analytics-job')

/**
 * Resolves a distinctId from event data.
 * Prefers userId (matches frontend PostHog identify), falls back to email fields.
 */
function resolveDistinctId(data: Record<string, unknown>): string | null {
  return (
    (data.userId as string) ||
    (data.createdById as string) ||
    (data.invitedById as string) ||
    (data.email as string) ||
    (data.userEmail as string) ||
    null
  )
}

/** Publishes AuxxEvents to PostHog for analytics tracking. */
export const publishToAnalyticsJob = async (job: Job<AuxxEvent>) => {
  const event = job.data
  const d = event.data as Record<string, unknown>

  const distinctId = resolveDistinctId(d)
  if (!distinctId) return

  if (configService.get<string>('NODE_ENV') === 'development') {
    logger.info('Analytics event captured:', { type: event.type })
  }

  const client = getPostHogClient()
  if (!client) return

  const { organizationId, ...properties } = d
  client.capture({
    distinctId,
    event: event.type,
    properties,
    groups: organizationId ? { organization: organizationId as string } : undefined,
  })
}
