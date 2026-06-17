// apps/web/src/app/(protected)/app/layout.tsx

import { headers } from 'next/headers'
import type { ReactNode } from 'react'
import { auth } from '~/auth/server'
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
  const session = await auth.api.getSession({ headers: await headers() })

  return (
    <AppsProvider>
      <AppLayoutWrapper user={session?.user}>{children}</AppLayoutWrapper>

      {/* Global extension dialog renderer */}
      <AppDialog />
    </AppsProvider>
  )
}
