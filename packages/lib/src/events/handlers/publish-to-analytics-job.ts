// packages/lib/src/events/handlers/publish-to-analytics-job.ts
import { configService } from '@auxx/credentials'
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

/**
 * Whether an event type is worth a PostHog capture.
 *
 * Per-field edits (`*:field:updated`) and the field-hook fan-out
 * (`field:trigger`) fire once per changed field on every write. They are
 * write-path noise, not product analytics: a single record save can emit
 * dozens of them, which drowns the events people actually look at and burns
 * PostHog volume for nothing.
 */
export function isAnalyticsEvent(type: string): boolean {
  if (type === 'field:trigger') return false
  if (type.endsWith(':field:updated')) return false
  return true
}

/** Captures one AuxxEvent to PostHog. Skips types {@link isAnalyticsEvent} rejects. */
export function captureAnalytics(event: AuxxEvent): void {
  if (!isAnalyticsEvent(event.type)) return

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

/**
 * Legacy job name. `publishEventJob` now calls {@link captureAnalytics} inline;
 * this stays registered so jobs queued before a deploy still resolve.
 */
export const publishToAnalyticsJob = async ({ data: event }: { data: AuxxEvent }) => {
  captureAnalytics(event)
}
