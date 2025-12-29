// apps/web/src/app/(protected)/app/layout.tsx
import { auth } from '~/auth/server'
import { headers } from 'next/headers'
import { AppLayoutWrapper } from './_components/app-layout-wrapper'
import { ExtensionsProvider } from '~/providers/extensions/extensions-provider'
import { ExtensionDialog } from '~/components/extensions/extension-dialog'
import { type ReactNode } from 'react'

interface AppLayoutProps {
  children: ReactNode
}

/**
 * Layout for main app routes (/app/*).
 * Wraps in ExtensionsProvider to load and manage all extensions,
 * then wraps in client component that checks subscription and shows Dashboard or SubscriptionEnded.
 */
export default async function AppLayout({ children }: AppLayoutProps) {
  const session = await auth.api.getSession({ headers: await headers() })

  return (
    <ExtensionsProvider>
      <AppLayoutWrapper user={session?.user}>{children}</AppLayoutWrapper>

      {/* Global extension dialog renderer */}
      <ExtensionDialog />
    </ExtensionsProvider>
  )
}
