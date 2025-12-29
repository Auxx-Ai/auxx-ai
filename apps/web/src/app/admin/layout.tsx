// apps/web/src/app/admin/layout.tsx

import { type Metadata } from 'next'
import { redirect } from 'next/navigation'
import { SidebarInset, SidebarProvider } from '@auxx/ui/components/sidebar'
import { AdminAppSidebar } from './_components/app-sidebar'
import { auth } from '~/auth/server'
import { headers } from 'next/headers'
import { DehydrationService } from '@auxx/lib/dehydration'
import { DehydratedStateProvider } from '~/providers/dehydrated-state-provider'
import { OrganizationIdProvider, FeatureFlagProvider } from '~/providers/feature-flag-provider'

export const metadata: Metadata = {
  title: {
    template: '%s | Auxx.ai Admin',
  },
}

/**
 * Admin layout - only accessible to super admins
 */
export default async function AdminLayout({ children }: { children: React.ReactNode }) {
  const session = await auth.api.getSession({ headers: await headers() }) // Use cached auth

  // Verify user is authenticated
  if (!session?.user) {
    redirect('/login')
  }

  // Verify user is super admin
  if (!session.user.isSuperAdmin) {
    redirect('/app')
  }

  const user = {
    id: session.user.id,
    name: session.user.name,
    email: session.user.email,
    emailVerified: session.user.emailVerified,
    image: session.user.image,
  }

  // Fetch dehydrated state for admin user
  const dehydrationService = new DehydrationService()
  let dehydratedState
  try {
    dehydratedState = await dehydrationService.getState(session.user.id)
  } catch (error) {
    console.error('Failed to fetch dehydrated state for admin:', error)
    // Provide empty state as fallback for admin
    dehydratedState = {
      user: {
        id: session.user.id,
        name: session.user.name,
        email: session.user.email,
      },
      organizations: [],
      organizationId: null,
      environment: {
        nodeEnv: process.env.NODE_ENV || 'development',
        isDevelopment: process.env.NODE_ENV === 'development',
      },
      settingsCatalog: {},
    }
  }

  return (
    <div className="h-screen flex flex-1 flex-col w-full h-full">
      <DehydratedStateProvider initialState={dehydratedState}>
        <OrganizationIdProvider initialOrganizationId={dehydratedState.organizationId}>
          <FeatureFlagProvider>
            <SidebarProvider>
              <AdminAppSidebar user={user} variant="inset" />
              <SidebarInset className="p-0 m-0!">{children}</SidebarInset>
            </SidebarProvider>
          </FeatureFlagProvider>
        </OrganizationIdProvider>
      </DehydratedStateProvider>
    </div>
  )
}
