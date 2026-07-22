// apps/web/src/app/admin/layout.tsx

import { DehydrationService } from '@auxx/lib/dehydration'
import { SidebarInset, SidebarProvider } from '@auxx/ui/components/sidebar'
import type { Metadata } from 'next'
import { cookies } from 'next/headers'
import { redirect } from 'next/navigation'
import { getSession } from '~/auth/session'
import { DehydratedStateProvider } from '~/providers/dehydrated-state-provider'
import { FeatureFlagProvider, OrganizationIdProvider } from '~/providers/feature-flag-provider'
import { AdminAppSidebar } from './_components/app-sidebar'

export const metadata: Metadata = {
  title: {
    template: '%s | Auxx.ai Admin',
  },
}

/**
 * Admin layout - only accessible to super admins
 */
export default async function AdminLayout({ children }: { children: React.ReactNode }) {
  const session = await getSession()

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

  // Admin sidebar persists its own open/width under `admin_sidebar*` cookies (independent of
  // the main app shell) — read them here so first paint matches the persisted size.
  const cookieStore = await cookies()
  const openCookie = cookieStore.get('admin_sidebar')?.value
  const widthCookie = cookieStore.get('admin_sidebar_width')?.value
  const defaultOpen = openCookie ? openCookie !== 'false' : undefined
  const parsedWidth = widthCookie ? Number.parseInt(widthCookie, 10) : Number.NaN
  const defaultWidth = Number.isFinite(parsedWidth) ? parsedWidth : undefined

  return (
    <div className='h-screen flex flex-1 flex-col w-full h-full'>
      <DehydratedStateProvider initialState={dehydratedState}>
        <OrganizationIdProvider>
          <FeatureFlagProvider>
            <SidebarProvider
              resizable
              persistKey='admin_sidebar'
              defaultOpen={defaultOpen}
              defaultWidth={defaultWidth}>
              <AdminAppSidebar user={user} variant='inset' />
              <SidebarInset className='p-0 m-0!'>{children}</SidebarInset>
            </SidebarProvider>
          </FeatureFlagProvider>
        </OrganizationIdProvider>
      </DehydratedStateProvider>
    </div>
  )
}
