// apps/build/src/app/(portal)/layout.tsx

import { redirect } from 'next/navigation'
import { getSession, getLoginUrl } from '~/lib/auth'
import { BuildDehydrationService } from '~/lib/dehydration'
import { BuildDehydratedStateProvider } from '~/components/providers/dehydrated-state-provider'

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
    redirect(getLoginUrl('/'))
  }

  return (
    <BuildDehydratedStateProvider initialState={dehydratedState}>
      {children}
    </BuildDehydratedStateProvider>
  )
}
