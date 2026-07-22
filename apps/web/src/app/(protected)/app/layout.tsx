// apps/web/src/app/(protected)/app/layout.tsx

import { cookies } from 'next/headers'
import type { ReactNode } from 'react'
import { getSession } from '~/auth/session'
import { AppDialog } from '~/components/apps/host/app-dialog'
import { AppsProvider } from '~/components/apps/providers/apps-provider'
import { AppLayoutWrapper } from './_components/app-layout-wrapper'

interface AppLayoutProps {
  children: ReactNode
}

/**
 * Layout for main app routes (/app/*).
 * Wraps in AppsProvider to load and manage all extensions,
 * then wraps in client component that checks subscription and shows Dashboard or SubscriptionEnded.
 */
export default async function AppLayout({ children }: AppLayoutProps) {
  const session = await getSession()

  // Read the persisted sidebar open/width cookies here so the shell renders at the right
  // size on first paint (no open-flash, no width-flash). Cookie names mirror the provider's
  // `persistKey` ('sidebar_state') + its `_width` companion.
  const cookieStore = await cookies()
  const sidebarStateCookie = cookieStore.get('sidebar_state')?.value
  const sidebarWidthCookie = cookieStore.get('sidebar_state_width')?.value
  const defaultSidebarOpen = sidebarStateCookie ? sidebarStateCookie !== 'false' : undefined
  const parsedWidth = sidebarWidthCookie ? Number.parseInt(sidebarWidthCookie, 10) : Number.NaN
  const defaultSidebarWidth = Number.isFinite(parsedWidth) ? parsedWidth : undefined

  return (
    <AppsProvider>
      <AppLayoutWrapper
        user={session?.user}
        defaultSidebarOpen={defaultSidebarOpen}
        defaultSidebarWidth={defaultSidebarWidth}>
        {children}
      </AppLayoutWrapper>

      {/* Global extension dialog renderer */}
      <AppDialog />
    </AppsProvider>
  )
}
