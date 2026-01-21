// components/organization/delete-organization-dialog.tsx
'use client'

import { useState } from 'react'
import { Button } from '@auxx/ui/components/button'
import {
  Dialog,
  DialogContent,
  DialogFooter,
  DialogHeader,
  DialogTitle,
} from '@auxx/ui/components/dialog'
import { Input } from '@auxx/ui/components/input'
import { Label } from '@auxx/ui/components/label'
import type { OrganizationMembership } from './types'

interface DeleteOrganizationDialogProps {
  open: boolean
  onOpenChange: (open: boolean) => void
  organization: OrganizationMembership | null
  userEmail: string | null | undefined
  onConfirm: (confirmationEmail: string) => void
  isPending: boolean
}

/** Dialog for confirming organization deletion with email verification */
export function DeleteOrganizationDialog({
  open,
  onOpenChange,
  organization,
  userEmail,
  onConfirm,
  isPending,
}: DeleteOrganizationDialogProps) {
  const [confirmationEmail, setConfirmationEmail] = useState('')
  const [inputError, setInputError] = useState<string | null>(null)

  const handleOpenChange = (isOpen: boolean) => {
    onOpenChange(isOpen)
    if (!isOpen) {
      setConfirmationEmail('')
      setInputError(null)
    }
  }

  const handleConfirm = () => {
    setInputError(null)
    if (!userEmail) {
      setInputError('Could not retrieve your email address. Please try again.')
      return
    }
    if (!confirmationEmail) {
      setInputError('Please enter your email address to confirm.')
      return
    }
    if (confirmationEmail.toLowerCase() !== userEmail.toLowerCase()) {
      setInputError('The entered email does not match your logged-in email.')
      return
    }
    onConfirm(confirmationEmail)
  }

  const isEmailMatch = confirmationEmail.toLowerCase() === userEmail?.toLowerCase()

  return (
    <Dialog open={open} onOpenChange={handleOpenChange}>
      <DialogContent>
        <DialogHeader>
          <DialogTitle>Are you absolutely sure?</DialogTitle>
        </DialogHeader>
        <div className="text-sm space-y-4">
          <div className="rounded-md bg-destructive/10 p-3 text-destructive font-medium">
            WARNING: If this is the ONLY organization any member belongs to (including yourself),
            their ENTIRE USER ACCOUNT on this platform will be PERMANENTLY DELETED along with the
            organization.
            <br />
            <br />
            This includes their login methods and all associated data. Ensure all members are aware
            or have joined other organizations if they wish to retain their accounts.
          </div>
          <p>
            This action is permanent and cannot be undone. This will delete the organization "
            {organization?.name || 'this organization'}" and all its data, including:
          </p>
          <ul className="list-disc pl-5">
            <li>All member access</li>
            <li>Tickets, emails, contacts</li>
            <li>Settings and integrations</li>
            <li>Products, orders, etc. (if applicable)</li>
          </ul>
          <div className="flex flex-col space-y-2">
            <Label htmlFor="deleteConfirmationEmail" className="font-semibold">
              To confirm, please type your email address:{' '}
              <span className="font-normal text-muted-foreground">({userEmail})</span>
            </Label>
            <Input
              id="deleteConfirmationEmail"
              type="email"
              value={confirmationEmail}
              onChange={(e) => setConfirmationEmail(e.target.value)}
              placeholder="your.email@example.com"
              disabled={isPending}
              className={inputError ? 'border-destructive focus-visible:ring-destructive' : ''}
            />
            {inputError && <p className="text-xs text-destructive">{inputError}</p>}
          </div>
        </div>
        <DialogFooter>
          <Button variant="outline" onClick={() => handleOpenChange(false)} disabled={isPending}>
            Cancel
          </Button>
          <Button
            variant="destructive"
            onClick={handleConfirm}
            disabled={isPending || !confirmationEmail || !isEmailMatch}
            loading={isPending}
            loadingText="Deleting...">
            Delete Permanently
          </Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  )
}
