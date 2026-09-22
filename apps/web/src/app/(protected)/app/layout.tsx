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
/** The `${key}` open cookie and its `${key}_width` companion, as written by `SidebarProvider`. */
function readSidebarCookies(store: Awaited<ReturnType<typeof cookies>>, key: string) {
  const openCookie = store.get(key)?.value
  const width = Number.parseInt(store.get(`${key}_width`)?.value ?? '', 10)
  return {
    open: openCookie ? openCookie !== 'false' : undefined,
    width: Number.isFinite(width) ? width : undefined,
  }
}

export default async function AppLayout({ children }: AppLayoutProps) {
  const session = await getSession()

  // Read the persisted sidebar open/width cookies here so the shell renders at the right
  // size on first paint (no open-flash, no width-flash). Names mirror each provider's `persistKey`.
  const cookieStore = await cookies()
  const sidebar = readSidebarCookies(cookieStore, 'sidebar_state')
  const secondarySidebar = readSidebarCookies(cookieStore, 'secondary_sidebar')

  return (
    <AppsProvider>
      <AppLayoutWrapper
        user={session?.user}
        defaultSidebarOpen={sidebar.open}
        defaultSidebarWidth={sidebar.width}
        defaultSecondarySidebar={secondarySidebar}>
        {children}
      </AppLayoutWrapper>

      {/* Global extension dialog renderer */}
      <AppDialog />
    </AppsProvider>
  )
}
