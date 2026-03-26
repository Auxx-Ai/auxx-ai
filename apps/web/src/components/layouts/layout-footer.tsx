// apps/web/src/components/layouts/layout-footer.tsx
'use client'

import type { DehydratedOrganization } from '@auxx/lib/dehydration'
import { Button } from '@auxx/ui/components/button'
import Link from 'next/link'
import { useRouter } from 'next/navigation'
import { client } from '~/auth/auth-client'
import { useDehydratedOrganizations, useEnv } from '~/providers/dehydrated-state-provider'
import { useOrganizationIdContext } from '~/providers/feature-flag-provider'

interface LayoutFooterProps {
  showBackToDashboard?: boolean
}

/** Helper function to check if current org subscription is active */
function hasActiveSubscription(subscription: DehydratedOrganization['subscription']): boolean {
  if (!subscription) return false
  const activeStatuses = ['active', 'trialing']
  return activeStatuses.includes(subscription.status.toLowerCase()) && !subscription.hasTrialEnded
}

/**
 * Shared footer navigation for lightweight layouts (onboarding, organizations, subscription).
 * Shows links to Dashboard (if subscription active), Organizations, Home, and Sign Out.
 */
export function LayoutFooter({ showBackToDashboard = true }: LayoutFooterProps) {
  const router = useRouter()
  const env = useEnv()
  const organizations = useDehydratedOrganizations()
  const { organizationId: currentOrgId } = useOrganizationIdContext()

  const currentOrg = organizations.find((org) => org.id === currentOrgId)
  const canAccessDashboard = hasActiveSubscription(currentOrg?.subscription ?? null)

  const handleLogout = async () => {
    try {
      await client.signOut()
      router.push('/login')
    } catch (error) {
      console.error('Error during logout:', error)
    }
  }

  return (
    <footer className='container flex items-center justify-center py-3'>
      <nav className='flex items-center gap-2 bg-white/20 rounded-lg backdrop-blur'>
        {showBackToDashboard && canAccessDashboard && (
          <Button variant='ghost' asChild size='sm' className='text-white/80'>
            <Link href='/app/dashboard'>Dashboard</Link>
          </Button>
        )}

        <Button variant='ghost' asChild size='sm' className='text-white/80 '>
          <Link href='/organizations'>Organizations</Link>
        </Button>

        <Button variant='ghost' asChild size='sm' className='text-white/80'>
          <Link href={env.homepageUrl} target='_blank' rel='noopener noreferrer'>
            Home
          </Link>
        </Button>

        <Button variant='ghost' onClick={handleLogout} size='sm' className='text-white/80'>
          Sign Out
        </Button>
      </nav>
    </footer>
  )
}
