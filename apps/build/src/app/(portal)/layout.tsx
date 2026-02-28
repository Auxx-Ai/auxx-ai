// apps/build/src/app/(portal)/layout.tsx

import { DEV_PORTAL_URL, WEBAPP_URL } from '@auxx/config/urls'
import { redirect } from 'next/navigation'
import { BuildDehydratedStateProvider } from '~/components/providers/dehydrated-state-provider'
import { getLocalSession, getLoginUrl } from '~/lib/auth'
import type { BuildDehydratedState } from '~/lib/dehydration'
import { BuildDehydrationService } from '~/lib/dehydration'

/** Minimal fallback state when dehydration fails (prevents redirect loop) */
function createFallbackState(session: { userId: string; email: string }): BuildDehydratedState {
  return {
    authenticatedUser: {
      id: session.userId,
      name: null,
      email: session.email,
      emailVerified: false,
      image: null,
      firstName: null,
      lastName: null,
      phoneNumber: null,
      phoneNumberVerified: false,
      createdAt: new Date(),
      updatedAt: new Date(),
    },
    developerAccounts: [],
    apps: [],
    organizations: [],
    invitedDeveloperAccounts: [],
    environment: {
      devPortalUrl: DEV_PORTAL_URL || '',
      webappUrl: WEBAPP_URL || '',
      nodeEnv: process.env.NODE_ENV || 'development',
      isDevelopment: process.env.NODE_ENV === 'development',
    },
    timestamp: Date.now(),
  }
}

/**
 * Portal layout - wraps all authenticated developer portal pages
 * Provides dehydrated state to all child routes
 */
export default async function PortalLayout({ children }: { children: React.ReactNode }) {
  // Get session (local JWT verification — no network call)
  const session = await getLocalSession()

  if (!session) {
    redirect(getLoginUrl('/'))
  }

  // Fetch dehydrated state for this user
  const dehydrationService = new BuildDehydrationService()
  let dehydratedState: BuildDehydratedState

  try {
    dehydratedState = await dehydrationService.getState(session.userId)
  } catch (error) {
    console.error('Failed to fetch dehydrated state:', error)
    // Use fallback state instead of deleting the cookie and redirecting,
    // which would create an infinite redirect loop when the error is persistent.
    dehydratedState = createFallbackState(session)
  }

  return (
    <BuildDehydratedStateProvider initialState={dehydratedState}>
      {children}
    </BuildDehydratedStateProvider>
  )
}
