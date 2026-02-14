// components/organization/leave-organization-dialog.tsx
'use client'

import { OrganizationRole as OrganizationRoleEnum } from '@auxx/database/enums'
import { Button } from '@auxx/ui/components/button'
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogFooter,
  DialogHeader,
  DialogTitle,
} from '@auxx/ui/components/dialog'
import type { OrganizationMembership } from './types'

interface LeaveOrganizationDialogProps {
  open: boolean
  onOpenChange: (open: boolean) => void
  organization: OrganizationMembership | null
  onConfirm: () => void
  isPending: boolean
}

/** Dialog for confirming organization leave action */
export function LeaveOrganizationDialog({
  open,
  onOpenChange,
  organization,
  onConfirm,
  isPending,
}: LeaveOrganizationDialogProps) {
  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent>
        <DialogHeader>
          <DialogTitle>Leave organization</DialogTitle>
          <DialogDescription>
            Are you sure you want to leave {organization?.name || 'this organization'}? You will
            lose access.
            {organization?.role === OrganizationRoleEnum.OWNER && (
              <span className='mt-2 block font-semibold text-destructive'>
                Warning: You are an Owner. Ensure ownership is transferred if necessary before
                leaving.
              </span>
            )}
          </DialogDescription>
        </DialogHeader>
        <DialogFooter>
          <Button variant='outline' onClick={() => onOpenChange(false)} disabled={isPending}>
            Cancel
          </Button>
          <Button variant='destructive' onClick={onConfirm} disabled={isPending}>
            {isPending ? 'Leaving...' : 'Leave Organization'}
          </Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  )
}
