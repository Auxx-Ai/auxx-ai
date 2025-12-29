import { env } from '@auxx/config/server'
import type { Job } from 'bullmq'

import { type AuxxEvent } from '../types'
import { PostHogClient } from '../../posthog/posthog-client'
import { createScopedLogger } from '../../logger'

const logger = createScopedLogger('publish-to-analytics-job')

export const publishToAnalyticsJob = async (job: Job<AuxxEvent>) => {
  const event = job.data
  let userEmail, organizationId
  if ('email' in event.data) {
    userEmail = event.data.email
  }
  if ('organizationId' in event.data) {
    organizationId = event.data.organizationId
  }

  if (!userEmail) return
  if (env.NODE_ENV === 'development') {
    logger.info('Analytics event captured:', { type: event.type })
  }

  const client = PostHogClient()
  if (!client) return

  client.capture({
    distinctId: userEmail,
    event: event.type,
    properties: { data: event.data, organizationId },
  })

  await client.shutdown()
}
