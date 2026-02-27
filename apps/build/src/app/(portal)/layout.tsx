// apps/build/src/app/(portal)/layout.tsx

import { cookies } from 'next/headers'
import { redirect } from 'next/navigation'
import { BuildDehydratedStateProvider } from '~/components/providers/dehydrated-state-provider'
import { getLocalSession, getLoginUrl } from '~/lib/auth'
import { BuildDehydrationService } from '~/lib/dehydration'

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
  let dehydratedState

  try {
    dehydratedState = await dehydrationService.getState(session.userId)
  } catch (error) {
    console.error('Failed to fetch dehydrated state:', error)

    // Clear stale session cookie to prevent infinite redirect loop.
    const cookieStore = await cookies()
    cookieStore.delete('auxx-build.session')
    redirect(getLoginUrl('/'))
  }

  return (
    <BuildDehydratedStateProvider initialState={dehydratedState}>
      {children}
    </BuildDehydratedStateProvider>
  )
}
