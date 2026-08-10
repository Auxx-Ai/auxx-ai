// apps/web/src/app/(protected)/organizations/page.tsx
'use client'

import type { DehydratedOrganization } from '@auxx/lib/dehydration'
import { capabilityKeySet, PermissionKey } from '@auxx/lib/permissions/client'
import { BLOCKED_SUBSCRIPTION_STATUSES } from '@auxx/types/billing'
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
import { Building, MoreVertical, Plus } from 'lucide-react'
import { useRouter } from 'next/navigation'
import { useState } from 'react'
import { CreateOrganizationDialog } from '~/components/global/create-org-dialog'
import { useConfirm } from '~/hooks/use-confirm'
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

  const isExpired = (BLOCKED_SUBSCRIPTION_STATUSES as readonly string[]).includes(
    org.subscription.status.toLowerCase()
  )
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

/**
 * `can('billing.view')` for an organization that may not be the active one.
 *
 * `useAccess()` can't answer this: it seeds from the ACTIVE org's snapshot only,
 * and this page lists every membership. The dehydration seed already carries a
 * per-org snapshot for each one (`assembleOrganization` resolves capabilities
 * per membership), so the gate reads off that, through the same front-door union
 * the provider's `can()` uses.
 *
 * No plan layer to mirror here — `billing.view` carries no `featureKey` in the
 * permission registry, so the provider's `hasAccess()` leg is always true for it.
 */
function canViewBilling(org: DehydratedOrganization): boolean {
  return capabilityKeySet(org.capabilities).has(PermissionKey.billingView)
}

/** Organization card component */
function OrganizationCard({
  org,
  isDefault,
  isCurrent,
  onOpen,
  onManageSubscription,
  onLeave,
  busy,
}: {
  org: DehydratedOrganization
  isDefault: boolean
  isCurrent: boolean
  onOpen: () => void
  onManageSubscription: () => void
  onLeave: () => void
  busy: boolean
}) {
  const status = getSubscriptionStatus(org)

  const handleCardClick = (e: React.MouseEvent) => {
    // Don't switch if clicking on dropdown
    if ((e.target as HTMLElement).closest('[data-dropdown-trigger]')) {
      return
    }
    if (!busy) {
      onOpen()
    }
  }

  return (
    <div
      onClick={handleCardClick}
      className={`group flex cursor-pointer hover:bg-muted/10 items-center justify-between rounded-2xl border-0 ring-1 ring-white/20 py-2 px-3 transition-colors duration-200 ${
        status.isActive && !isCurrent
          ? 'hover:bg-muted cursor-pointer'
          : isCurrent
            ? 'border-primary'
            : 'opacity-60'
      }`}>
      <div className='flex flex-row items-center gap-2'>
        <div
          className={`size-8 border bg-muted/10 border-white/10 rounded-lg flex items-center justify-center transition-colors shrink-0 ${
            status.isActive && !isCurrent ? 'group-hover:bg-muted/20' : ''
          }`}>
          <Building className='size-4' />
        </div>
        <div className='flex flex-col'>
          <div className='flex items-center gap-2'>
            <span className='text-sm'>{org.name || `Organization ${org.id.substring(0, 6)}`}</span>
            {isDefault && (
              <Badge size='xs' variant='default'>
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
            <span className='text-xs text-white/50'>
              {org.handle || `@${org.id.substring(0, 8)}`}
            </span>
            {org.subscription && (
              <>
                <span className='text-xs text-white/50'>•</span>
                <span className='text-xs text-white/50'>{status.label}</span>
              </>
            )}
          </div>
        </div>
      </div>
      <div className='flex items-center gap-2'>
        <DropdownMenu>
          <DropdownMenuTrigger asChild data-dropdown-trigger>
            <Button variant='ghost' size='icon-sm' className='hover:bg-muted/20 hover:text-white'>
              <MoreVertical />
            </Button>
          </DropdownMenuTrigger>
          <DropdownMenuContent align='end'>
            {canViewBilling(org) && (
              <DropdownMenuItem
                disabled={busy}
                onClick={(e) => {
                  e.stopPropagation()
                  onManageSubscription()
                }}>
                Manage Subscription
              </DropdownMenuItem>
            )}
            <DropdownMenuItem
              variant='destructive'
              disabled={busy}
              onClick={(e) => {
                e.stopPropagation()
                onLeave()
              }}>
              Leave Organization
            </DropdownMenuItem>
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
  const [createDialogOpen, setCreateDialogOpen] = useState(false)
  const [confirm, ConfirmDialog] = useConfirm()

  const switchOrg = api.organization.setDefault.useMutation({
    onError: (error) => {
      toastError({ title: 'Failed to switch organization', description: error.message })
      setSwitching(false)
    },
  })

  const leaveOrg = api.organization.leave.useMutation({
    onError: (error) => {
      toastError({ title: 'Failed to leave organization', description: error.message })
    },
  })

  const busy = switching || leaveOrg.isPending

  /**
   * Make `orgId` the active organization if it isn't already, then navigate to
   * `destination`. Switching is what makes the destination resolve against the
   * right org — every in-app route reads the active org from context.
   */
  const openOrg = async (orgId: string, destination: string) => {
    if (orgId === currentOrgId) {
      router.push(destination)
      return
    }

    setSwitching(true)
    try {
      const data = await switchOrg.mutateAsync({ organizationId: orgId })
      setOrganizationId(data.organizationId)
      router.push(destination)
      router.refresh()
    } catch {
      // onError already toasted and cleared `switching`
    }
  }

  const handleLeave = async (org: DehydratedOrganization) => {
    const label = org.name || org.handle || 'this organization'
    const confirmed = await confirm({
      title: `Leave ${label}?`,
      description:
        'You will immediately lose access to this organization, and any personal email channels you connected here stop syncing. You need a new invite to rejoin.',
      confirmText: 'Leave',
      cancelText: 'Cancel',
      destructive: true,
    })
    if (!confirmed) return

    try {
      await leaveOrg.mutateAsync({ organizationId: org.id })
      // The server picks the replacement default org when the one being left was
      // the default, so re-read it from the server rather than guessing here.
      router.refresh()
    } catch {
      // onError already toasted
    }
  }

  return (
    <div className='flex min-h-[calc(100vh-8rem)] w-screen items-center justify-center p-4'>
      <div className='flex w-full max-w-md flex-col items-center space-y-5 px-6'>
        <Card
          variant='translucent'
          className='w-full  shadow-md shadow-black/20 border-transparent'>
          <CardHeader className='text-center'>
            <div className='mx-auto mb-5 size-14 border flex items-center justify-center rounded-2xl bg-muted '>
              <Building className='size-8 text-info' />
            </div>

            <CardTitle className='text-white'>Organizations</CardTitle>
            <CardDescription>Jump into an existing workspace or add a new one</CardDescription>
          </CardHeader>
          <CardContent className='flex flex-col min-h-[300px]'>
            <div className='space-y-3 flex-1'>
              {organizations.length > 0 ? (
                organizations.map((org) => (
                  <OrganizationCard
                    key={org.id}
                    org={org}
                    isDefault={org.id === user.defaultOrganizationId}
                    isCurrent={org.id === currentOrgId}
                    onOpen={() => openOrg(org.id, '/app')}
                    onManageSubscription={() => openOrg(org.id, '/app/settings/plans')}
                    onLeave={() => handleLeave(org)}
                    busy={busy}
                  />
                ))
              ) : (
                <p className='text-center text-sm text-white/50 py-4'>
                  You are not a member of any organizations.
                </p>
              )}
            </div>
            <Button
              variant='translucent'
              className='w-full mt-3'
              onClick={() => setCreateDialogOpen(true)}>
              <Plus />
              Add new organization
            </Button>
          </CardContent>
        </Card>
        <CreateOrganizationDialog open={createDialogOpen} onOpenChange={setCreateDialogOpen} />
        <ConfirmDialog />
      </div>
    </div>
  )
}
