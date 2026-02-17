// apps/web/src/providers/posthog-provider.tsx
'use client'

import { PostHogProvider as PHProvider, usePostHog } from '@posthog/react'
import posthog from 'posthog-js'
import { type ReactNode, useEffect } from 'react'
import {
  useDehydratedOrganization,
  useDehydratedOrganizationId,
  useDehydratedUser,
  useEnv,
} from '~/providers/dehydrated-state-provider'

/** Module-level flag to ensure posthog.init() is called only once */
let posthogInitialized = false

/**
 * Identifies the current user and sets the organization group in PostHog.
 * Must be rendered as a child of PHProvider so usePostHog() returns the initialized client.
 */
function PostHogIdentify() {
  const ph = usePostHog()
  const user = useDehydratedUser()
  const orgId = useDehydratedOrganizationId()
  const org = useDehydratedOrganization(orgId)

  useEffect(() => {
    if (!ph || !user) return
    ph.identify(user.id, { email: user.email, name: user.name })
    if (orgId) {
      ph.group('organization', orgId, { name: org?.name })
    }
  }, [ph, user, orgId, org?.name])

  return null
}

/**
 * Initializes PostHog client-side analytics with automatic pageview tracking,
 * user identification, and organization grouping.
 * Renders children directly (no-op) when PostHog key is not configured.
 */
export function PostHogProvider({ children }: { children: ReactNode }) {
  const { posthog: config } = useEnv()

  // Skip PostHog when not configured (self-hosted without PostHog)
  if (!config.key) {
    return <>{children}</>
  }

  // Init synchronously before first render so the client is ready for children
  if (typeof window !== 'undefined' && !posthogInitialized) {
    posthog.init(config.key, {
      api_host: '/ph',
      ui_host: 'https://us.posthog.com',
      capture_pageview: true,
      capture_pageleave: true,
    })
    posthogInitialized = true
  }

  return (
    <PHProvider client={posthog}>
      <PostHogIdentify />
      {children}
    </PHProvider>
  )
}
