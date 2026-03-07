// apps/web/src/app/(protected)/layout.tsx

import { DehydrationService } from '@auxx/lib/dehydration'
import { headers } from 'next/headers'
import { redirect } from 'next/navigation'
import Script from 'next/script'
import type { ReactNode } from 'react'
import { auth } from '~/auth/server'
import { DehydratedStateProvider } from '~/providers/dehydrated-state-provider'
import { FeatureFlagProvider, OrganizationIdProvider } from '~/providers/feature-flag-provider'
import { PostHogProvider } from '~/providers/posthog-provider'

interface ProtectedLayoutProps {
  children: ReactNode
}

/**
 * Parent layout for all protected routes.
 * Handles auth, dehydration, and provides context to all child route groups.
 */
export default async function ProtectedLayout({ children }: ProtectedLayoutProps) {
  const session = await auth.api.getSession({ headers: await headers() })

  // Require authentication
  if (!session?.user) {
    redirect('/login')
  }

  // Block banned users
  if ((session.user as any).banned) {
    redirect('/deactivated')
  }

  // Force password change if flagged by admin
  if ((session.user as any).forcePasswordChange) {
    redirect('/change-password?forced=true')
  }

  // Fetch dehydrated state on server with error handling
  const dehydrationService = new DehydrationService()
  let dehydratedState
  try {
    dehydratedState = await dehydrationService.getState(session.user.id)
  } catch (error) {
    console.error('Failed to fetch dehydrated state:', error)
    redirect('/error?message=failed-to-load-state')
  }

  return (
    <>
      {/* Inject dehydrated state into window BEFORE React hydration */}
      <Script
        id='dehydrated-state'
        strategy='beforeInteractive'
        dangerouslySetInnerHTML={{
          __html: `window.AUXX_DEHYDRATED_STATE = ${JSON.stringify(dehydratedState).replace(/</g, '\\u003c').replace(/>/g, '\\u003e')};`,
        }}
      />

      <DehydratedStateProvider initialState={dehydratedState}>
        <OrganizationIdProvider>
          <FeatureFlagProvider>
            <PostHogProvider>{children}</PostHogProvider>
          </FeatureFlagProvider>
        </OrganizationIdProvider>
      </DehydratedStateProvider>
    </>
  )
}
