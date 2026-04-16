// apps/homepage/src/providers/posthog-provider.tsx
'use client'

import { usePathname } from 'next/navigation'
import posthog from 'posthog-js'
import { type ReactNode, useEffect, useRef } from 'react'

/** Module-level flag to ensure posthog.init() is called only once */
let posthogInitialized = false

/**
 * Initializes PostHog client-side analytics for the homepage.
 * Anonymous tracking only — no user identification.
 * Receives PostHog config as props from the server layout.
 */
export function PostHogProvider({
  children,
  posthogKey,
  posthogHost,
}: {
  children: ReactNode
  posthogKey: string
  posthogHost: string
}) {
  const pathname = usePathname()
  const prevPathname = useRef(pathname)

  // Init synchronously before first render so the client is ready
  if (typeof window !== 'undefined' && !posthogInitialized && posthogKey) {
    posthog.init(posthogKey, {
      api_host: posthogHost,
      ui_host: 'https://us.posthog.com',
      capture_pageview: true,
      capture_pageleave: true,
    })
    posthogInitialized = true
  }

  // Track SPA navigations
  useEffect(() => {
    if (!posthogKey || !posthogInitialized) return
    if (prevPathname.current !== pathname) {
      posthog.capture('$pageview')
      prevPathname.current = pathname
    }
  }, [pathname, posthogKey])

  return <>{children}</>
}
