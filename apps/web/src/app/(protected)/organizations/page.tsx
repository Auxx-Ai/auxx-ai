// apps/web/src/app/(protected)/organizations/page.tsx
'use client'

import type { DehydratedOrganization } from '@auxx/lib/dehydration'
import { Badge } from '@auxx/ui/components/badge'
import { Button } from '@auxx/ui/components/button'
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from '@auxx/ui/components/card'
import {
  DropdownMenu,
  DropdownMenuContent,
  DropdownMenuItem,
  DropdownMenuTrigger,
} from '@auxx/ui/components/dropdown-menu'
import { toastError } from '@auxx/ui/components/toast'
import { Building, MoreVertical } from 'lucide-react'
import { useRouter } from 'next/navigation'
import { useState } from 'react'
import {
  useDehydratedOrganizations,
  useDehydratedUser,
} from '~/providers/dehydrated-state-provider'
import { useOrganizationIdContext } from '~/providers/feature-flag-provider'
import { api } from '~/trpc/react'

/** Helper to get subscription status */
function getSubscriptionStatus(org: DehydratedOrganization) {
  if (!org.subscription) {
    return { label: 'No Subscription', isActive: false }
  }

  const expiredStatuses = ['canceled', 'unpaid', 'past_due', 'incomplete_expired']
  const isExpired = expiredStatuses.includes(org.subscription.status.toLowerCase())
  const isTrialEnded = org.subscription.hasTrialEnded

  if (isExpired) {
    return { label: 'Expired', isActive: false }
  }
  if (isTrialEnded) {
    return { label: 'Trial Ended', isActive: false }
  }
  if (org.subscription.status === 'trialing') {
    return { label: 'Trial', isActive: true }
  }
  if (org.subscription.status === 'active') {
    return { label: 'Active', isActive: true }
  }

  return { label: org.subscription.status, isActive: false }
}

/** Organization card component */
function OrganizationCard({
  org,
  isDefault,
  isCurrent,
  onSwitch,
  onNavigate,
  switching,
}: {
  org: DehydratedOrganization
  isDefault: boolean
  isCurrent: boolean
  onSwitch: () => void
  onNavigate: () => void
  switching: boolean
}) {
  const status = getSubscriptionStatus(org)

  const handleCardClick = (e: React.MouseEvent) => {
    // Don't switch if clicking on dropdown
    if ((e.target as HTMLElement).closest('[data-dropdown-trigger]')) {
      return
    }
    if (!switching) {
      if (isCurrent) {
        onNavigate()
      } else {
        onSwitch()
      }
    }
  }

  return (
    <div
      onClick={handleCardClick}
      className={`group flex cursor-pointer hover:bg-muted items-center justify-between rounded-2xl border-0 ring-1 ring-border-illustration py-2 px-3 transition-colors duration-200 ${
        status.isActive && !isCurrent
          ? 'hover:bg-muted cursor-pointer'
          : isCurrent
            ? 'border-primary'
            : 'opacity-60'
      }`}>
      <div className='flex flex-row items-center gap-2'>
        <div
          className={`size-8 border bg-muted rounded-lg flex items-center justify-center transition-colors shrink-0 ${
            status.isActive && !isCurrent ? 'group-hover:bg-secondary' : ''
          }`}>
          <Building className='size-4' />
        </div>
        <div className='flex flex-col'>
          <div className='flex items-center gap-2'>
            <span className='text-sm'>{org.name || `Organization ${org.id.substring(0, 6)}`}</span>
            {isDefault && (
              <Badge size='xs' variant='outline'>
                Default
              </Badge>
            )}
            {isCurrent && (
              <Badge size='xs' variant='default'>
                Current
              </Badge>
            )}
          </div>
          <div className='flex items-center gap-2'>
            <span className='text-xs text-muted-foreground'>
              {org.handle || `@${org.id.substring(0, 8)}`}
            </span>
            {org.subscription && (
              <>
                <span className='text-xs text-muted-foreground'>•</span>
                <span className='text-xs text-muted-foreground'>{status.label}</span>
              </>
            )}
          </div>
        </div>
      </div>
      <div className='flex items-center gap-2'>
        <DropdownMenu>
          <DropdownMenuTrigger asChild data-dropdown-trigger>
            <Button variant='ghost' size='icon-sm'>
              <MoreVertical />
            </Button>
          </DropdownMenuTrigger>
          <DropdownMenuContent align='end'>
            <DropdownMenuItem
              variant='destructive'
              onClick={(e) => {
                e.stopPropagation()
                // Handle delete
              }}>
              Leave Organization
            </DropdownMenuItem>
            {!status.isActive && (
              <DropdownMenuItem
                onClick={(e) => {
                  e.stopPropagation()
                  window.location.href = `/subscription?org=${org.id}`
                }}>
                Manage Subscription
              </DropdownMenuItem>
            )}
          </DropdownMenuContent>
        </DropdownMenu>
      </div>
    </div>
  )
}

export default function OrganizationsPage() {
  const organizations = useDehydratedOrganizations()
  const user = useDehydratedUser()!
  const { organizationId: currentOrgId, setOrganizationId } = useOrganizationIdContext()
  const router = useRouter()
  const [switching, setSwitching] = useState(false)

  const switchOrg = api.organization.setDefault.useMutation({
    onSuccess: (data) => {
      setOrganizationId(data.organizationId)
      router.push('/app')
      router.refresh()
    },
    onError: (error) => {
      toastError({ title: 'Failed to switch organization', description: error.message })
      setSwitching(false)
    },
  })

  const handleSwitch = async (orgId: string) => {
    setSwitching(true)
    await switchOrg.mutateAsync({ organizationId: orgId })
  }

  const handleNavigate = () => {
    router.push('/app')
  }

  return (
    <div className='flex min-h-[calc(100vh-8rem)] w-screen items-center justify-center p-4'>
      <div className='flex w-full max-w-md flex-col items-center space-y-5 px-6'>
        <Card className='w-full bg-background shadow-md shadow-black/20 border-transparent'>
          <CardHeader className='text-center'>
            <div className='mx-auto mb-5 size-14 border flex items-center justify-center rounded-2xl bg-muted '>
              <Building className='size-8 text-info' />
            </div>

            <CardTitle>Organizations</CardTitle>
            <CardDescription>Jump into an existing workspace or add a new one</CardDescription>
          </CardHeader>
          <CardContent className='space-y-3 min-h-[300px]'>
            {organizations.length > 0 ? (
              organizations.map((org) => (
                <OrganizationCard
                  key={org.id}
                  org={org}
                  isDefault={org.id === user.defaultOrganizationId}
                  isCurrent={org.id === currentOrgId}
                  onSwitch={() => handleSwitch(org.id)}
                  onNavigate={handleNavigate}
                  switching={switching}
                />
              ))
            ) : (
              <p className='text-center text-sm text-muted-foreground py-4'>
                You are not a member of any organizations.
              </p>
            )}
          </CardContent>
        </Card>
      </div>
    </div>
  )
}
