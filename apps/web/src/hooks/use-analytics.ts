// apps/web/src/hooks/use-analytics.ts

import { usePostHog } from '@posthog/react'
import type { PostHog } from 'posthog-js'
import { useEnvironment } from '~/providers/dehydrated-state-provider'

/**
 * Convenience wrapper around usePostHog that returns null
 * when PostHog is not configured (e.g. self-hosted without analytics).
 *
 * Usage:
 *   const posthog = useAnalytics()
 *   posthog?.capture('workflow_created', { nodeCount: 5 })
 */
export function useAnalytics(): PostHog | null {
  const { posthog: config } = useEnvironment()
  const posthog = usePostHog()
  if (!config.key) return null
  return posthog
}
