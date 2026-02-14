// apps/build/src/components/layouts/simple-layout.tsx
'use client'

import { env } from '@auxx/config/client'
import { Button } from '@auxx/ui/components/button'
// import { client } from '~/auth/auth-client'
import Link from 'next/link'
import { useRouter } from 'next/navigation'
import type { ReactNode } from 'react'
import { Logo } from '~/components/logo'
// import { useEnvironment, useDehydratedOrganizations } from '~/providers/dehydrated-state-provider'
// import { useOrganizationIdContext } from '~/providers/feature-flag-provider'
// import type { DehydratedOrganization } from '@auxx/lib/dehydration'
import { ColorfulBg } from './colorful-bg'

interface SimpleLayoutProps {
  children: ReactNode
  title?: string
  showBackToDashboard?: boolean
}

/** Helper function to check if current org subscription is active */
// function hasActiveSubscription(subscription: DehydratedOrganization['subscription']): boolean {
//   if (!subscription) return false
//   const activeStatuses = ['active', 'trialing']
//   return activeStatuses.includes(subscription.status.toLowerCase()) && !subscription.hasTrialEnded
// }

/**
 * Simple layout for subscription and organization management.
 * Lightweight header with logo and basic navigation.
 */
export function SimpleLayout({ children, title, showBackToDashboard = true }: SimpleLayoutProps) {
  const router = useRouter()
  // const env = useEnvironment()
  // const organizations = useDehydratedOrganizations()
  // const { organizationId: currentOrgId } = useOrganizationIdContext()

  // const currentOrg = organizations.find((org) => org.id === currentOrgId)
  // const canAccessDashboard = hasActiveSubscription(currentOrg?.subscription ?? null)

  const handleLogout = async () => {
    try {
      // await client.signOut()
      // router.push('/login')
    } catch (error) {
      console.error('Error during logout:', error)
    }
  }

  return (
    <ColorfulBg>
      <div className='min-h-screen flex flex-col flex-1'>
        {/* Header */}
        <header className='sticky top-0 z-50 w-full'>
          <div className='container flex h-16 items-center justify-between'>
            <div className='flex items-center gap-4 mx-auto'>
              <Logo />
            </div>
          </div>
        </header>

        {/* Main Content */}
        <main className='flex-1 flex min-h-0 flex-col'>{children}</main>
        <footer className='container flex items-center justify-center py-3'>
          <nav className='flex items-center gap-2'>
            {/* {showBackToDashboard && canAccessDashboard && (
              <Button variant="ghost" asChild size="sm">
                <Link href="/app/dashboard">Dashboard</Link>
              </Button>
            )} */}

            <Button variant='ghost' asChild size='sm'>
              <Link href='/organizations'>Organizations</Link>
            </Button>

            <Button variant='ghost' asChild size='sm'>
              <Link href={'https://auxx.ai'} target='_blank' rel='noopener noreferrer'>
                Home
              </Link>
            </Button>

            <Button variant='ghost' onClick={handleLogout} size='sm'>
              Sign Out
            </Button>
          </nav>
        </footer>
      </div>
    </ColorfulBg>
  )
}
