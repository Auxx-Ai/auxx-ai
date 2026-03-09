// apps/build/src/components/apps/add-to-org-dialog.tsx
'use client'

import { Badge } from '@auxx/ui/components/badge'
import { Button } from '@auxx/ui/components/button'
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogHeader,
  DialogTitle,
} from '@auxx/ui/components/dialog'
import { Skeleton } from '@auxx/ui/components/skeleton'
import { Building, Check, Plus } from 'lucide-react'
import { toastError } from '~/components/global/toast'
import { api } from '~/trpc/react'

interface AddToOrgDialogProps {
  open: boolean
  onOpenChange: (open: boolean) => void
  appId: string
}

/**
 * Dialog for adding/removing an app to/from the user's organizations.
 */
export function AddToOrgDialog({ open, onOpenChange, appId }: AddToOrgDialogProps) {
  const utils = api.useUtils()

  const { data: organizations, isLoading } = api.apps.getOrganizations.useQuery(
    { appId },
    { enabled: open }
  )

  const addToOrg = api.apps.addToOrganization.useMutation({
    onSuccess: () => {
      utils.apps.getOrganizations.invalidate({ appId })
    },
    onError: (error) => {
      toastError({ title: 'Failed to add app', description: error.message })
    },
  })

  const removeFromOrg = api.apps.removeFromOrganization.useMutation({
    onSuccess: () => {
      utils.apps.getOrganizations.invalidate({ appId })
    },
    onError: (error) => {
      toastError({ title: 'Failed to remove app', description: error.message })
    },
  })

  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent className='sm:max-w-md'>
        <DialogHeader>
          <DialogTitle>Add to Organization</DialogTitle>
          <DialogDescription>
            Install this app as a development build in your organizations.
          </DialogDescription>
        </DialogHeader>

        <div className='py-2'>
          {isLoading ? (
            <div className='space-y-2'>
              {[...Array(2)].map((_, i) => (
                <Skeleton key={i} className='h-12 w-full' />
              ))}
            </div>
          ) : !organizations || organizations.length === 0 ? (
            <div className='text-sm text-muted-foreground py-4 text-center'>
              You are not a member of any organizations.
            </div>
          ) : (
            <div className='space-y-1'>
              {organizations.map((org) => (
                <div
                  key={org.id}
                  className='flex items-center justify-between rounded-md border px-3 py-2.5'>
                  <div className='flex items-center gap-2.5'>
                    <Building className='h-4 w-4 text-muted-foreground' />
                    <div>
                      <div className='text-sm font-medium'>{org.name ?? org.slug}</div>
                      <div className='text-xs text-muted-foreground'>@{org.slug}</div>
                    </div>
                  </div>

                  <div className='flex items-center gap-2'>
                    {org.isInstalled && org.installationType === 'production' ? (
                      <Badge variant='default'>Production</Badge>
                    ) : org.isInstalled ? (
                      <Button
                        variant='outline'
                        size='sm'
                        loading={removeFromOrg.isPending}
                        onClick={() => removeFromOrg.mutate({ appId, organizationId: org.id })}>
                        <Check />
                        Installed
                      </Button>
                    ) : (
                      <Button
                        variant='outline'
                        size='sm'
                        loading={addToOrg.isPending}
                        onClick={() => addToOrg.mutate({ appId, organizationId: org.id })}>
                        <Plus />
                        Add
                      </Button>
                    )}
                  </div>
                </div>
              ))}
            </div>
          )}
        </div>
      </DialogContent>
    </Dialog>
  )
}
