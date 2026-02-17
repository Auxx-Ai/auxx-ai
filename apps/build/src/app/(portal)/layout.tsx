// apps/build/src/app/(portal)/layout.tsx

import { cookies } from 'next/headers'
import { redirect } from 'next/navigation'
import { BuildDehydratedStateProvider } from '~/components/providers/dehydrated-state-provider'
import { getLoginUrl, getSession } from '~/lib/auth'
import { BuildDehydrationService } from '~/lib/dehydration'

/**
 * Portal layout - wraps all authenticated developer portal pages
 * Provides dehydrated state to all child routes
 */
export default async function PortalLayout({ children }: { children: React.ReactNode }) {
  // Get session (existing auth system)
  const session = await getSession()

  if (!session) {
    redirect(getLoginUrl('/'))
  }

  // Fetch dehydrated state for this user
  const dehydrationService = new BuildDehydrationService()
  let dehydratedState

  try {
    dehydratedState = await dehydrationService.getState(session.userId)
  } catch (error) {
    console.error('Failed to fetch dehydrated state:', error)

    // Clear stale session cookie to prevent infinite redirect loop.
    // Without this, the user has a valid session but no DB record,
    // so login keeps bouncing them back here.
    const cookieStore = await cookies()
    cookieStore.delete('better-auth.session_token')
    redirect(getLoginUrl('/'))
  }

  return (
    <BuildDehydratedStateProvider initialState={dehydratedState}>
      {children}
    </BuildDehydratedStateProvider>
  )
}
