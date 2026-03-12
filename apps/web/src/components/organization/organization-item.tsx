// components/organization/organization-item.tsx
'use client'

import { OrganizationRole as OrganizationRoleEnum } from '@auxx/database/enums'
import type { OrganizationRole } from '@auxx/database/types'
import { Badge } from '@auxx/ui/components/badge'
import { Button } from '@auxx/ui/components/button'
import {
  DropdownMenu,
  DropdownMenuContent,
  DropdownMenuItem,
  DropdownMenuSeparator,
  DropdownMenuTrigger,
} from '@auxx/ui/components/dropdown-menu'
import { toastError, toastSuccess } from '@auxx/ui/components/toast'
import { EllipsisVertical, LogOut, Shield, ShieldAlert, Trash2, UserCircle2 } from 'lucide-react'
import { useRouter } from 'next/navigation'
import { useState } from 'react'
import { useSession } from '~/auth/auth-client'
import { clearResourceCaches } from '~/components/resources'
import { useUser } from '~/hooks/use-user'
import { useDehydratedOrganizationId } from '~/providers/dehydrated-state-provider'
import { api } from '~/trpc/react'
import { DeleteOrganizationDialog } from './delete-organization-dialog'
import type { OrganizationMembership } from './types'

interface OrganizationItemProps {
  organization: OrganizationMembership
  isDefault: boolean
  canLeave: boolean
  onLeave: () => void
  isLeaving: boolean
}

/** Returns the appropriate icon for an organization role */
function getRoleIcon(role: OrganizationRole) {
  switch (role) {
    case OrganizationRoleEnum.OWNER:
      return <ShieldAlert className='size-4 text-primary-500' />
    case OrganizationRoleEnum.ADMIN:
      return <Shield className='size-4 text-indigo-500' />
    case OrganizationRoleEnum.USER:
      return <UserCircle2 className='size-4 text-muted-foreground' />
  }
}

/** Displays a single organization membership row with actions */
export function OrganizationItem({
  organization,
  isDefault,
  canLeave,
  onLeave,
  isLeaving,
}: OrganizationItemProps) {
  const router = useRouter()
  const { data: session } = useSession()
  const { switchOrganization } = useUser()
  const currentOrganizationId = useDehydratedOrganizationId()
  const utils = api.useUtils()

  const [isDeleteDialogOpen, setIsDeleteDialogOpen] = useState(false)

  const isOwner = organization.role === OrganizationRoleEnum.OWNER

  const deleteOrganization = api.organization.delete.useMutation({
    onSuccess: async () => {
      const isDeletingCurrentOrg = organization.id === currentOrganizationId

      toastSuccess({
        title: 'Organization Deleted',
        description: `${organization.name || 'The organization'} has been deleted.`,
      })
      setIsDeleteDialogOpen(false)

      if (isDeletingCurrentOrg) {
        clearResourceCaches()
        await utils.invalidate()
        router.push('/organizations')
      } else {
        await utils.organization.list.invalidate()
      }
    },
    onError: (error) => {
      toastError({ title: 'Deletion Failed', description: error.message })
    },
  })

  const handleSwitchOrganization = () => {
    switchOrganization(organization.id)
  }

  const handleDeleteOrganization = (confirmationEmail: string) => {
    deleteOrganization.mutate({
      organizationId: organization.id,
      confirmationEmail,
    })
  }

  return (
    <>
      <div className='group flex items-center justify-between rounded-2xl border py-2 px-3 hover:bg-muted transition-colors duration-200'>
        <div className='flex flex-row items-center gap-2'>
          <div className='size-8 border bg-muted rounded-lg flex items-center justify-center group-hover:bg-secondary transition-colors shrink-0'>
            {getRoleIcon(organization.role)}
          </div>
          <div className='flex flex-col'>
            <div className='flex items-center gap-2'>
              <span className='text-sm'>
                {organization.name || `Organization ${organization.id.substring(0, 6)}`}
              </span>
              {isDefault && (
                <Badge size='xs' variant='user'>
                  Default
                </Badge>
              )}
              <span className='flex items-center gap-1 text-xs text-muted-foreground'>
                {organization.role}
              </span>
            </div>
            {organization.handle && (
              <span className='text-xs text-muted-foreground font-mono'>{organization.handle}</span>
            )}
          </div>
        </div>
        <div className='flex items-center gap-2'>
          {!isDefault && (
            <Button
              variant='outline'
              size='sm'
              onClick={handleSwitchOrganization}
              disabled={isLeaving}>
              Switch
            </Button>
          )}
          <DropdownMenu>
            <DropdownMenuTrigger asChild>
              <Button variant='ghost' size='icon-xs'>
                <EllipsisVertical />
              </Button>
            </DropdownMenuTrigger>
            <DropdownMenuContent align='end'>
              {canLeave ? (
                <DropdownMenuItem variant='destructive' onClick={onLeave} disabled={isLeaving}>
                  <LogOut />
                  Leave
                </DropdownMenuItem>
              ) : (
                <DropdownMenuItem disabled variant='destructive'>
                  <LogOut />
                  Leave
                </DropdownMenuItem>
              )}
              <DropdownMenuSeparator />
              {isOwner && (
                <DropdownMenuItem variant='destructive' onClick={() => setIsDeleteDialogOpen(true)}>
                  <Trash2 />
                  Delete
                </DropdownMenuItem>
              )}
            </DropdownMenuContent>
          </DropdownMenu>
        </div>
      </div>

      {isDeleteDialogOpen && (
        <DeleteOrganizationDialog
          open={isDeleteDialogOpen}
          onOpenChange={setIsDeleteDialogOpen}
          organization={organization}
          userEmail={session?.user?.email}
          onConfirm={handleDeleteOrganization}
          isPending={deleteOrganization.isPending}
        />
      )}
    </>
  )
}
