// apps/web/src/app/admin/developer-accounts/_components/add-member-dialog.tsx
'use client'

import { Button } from '@auxx/ui/components/button'
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogFooter,
  DialogHeader,
  DialogTitle,
} from '@auxx/ui/components/dialog'
import { Input } from '@auxx/ui/components/input'
import { Label } from '@auxx/ui/components/label'
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from '@auxx/ui/components/select'
import { toastError } from '@auxx/ui/components/toast'
import { useState } from 'react'
import { api } from '~/trpc/react'

interface AddMemberDialogProps {
  open: boolean
  onOpenChange: (open: boolean) => void
  developerAccountId: string
  onMemberAdded: () => void
}

/**
 * Dialog to add a member to a developer account by email.
 */
export function AddMemberDialog({
  open,
  onOpenChange,
  developerAccountId,
  onMemberAdded,
}: AddMemberDialogProps) {
  const [email, setEmail] = useState('')
  const [accessLevel, setAccessLevel] = useState<'member' | 'admin'>('member')

  const addMember = api.admin.addDeveloperAccountMember.useMutation({
    onSuccess: () => {
      onMemberAdded()
      setEmail('')
      setAccessLevel('member')
      onOpenChange(false)
    },
    onError: (error) => {
      toastError({ title: 'Failed to add member', description: error.message })
    },
  })

  const handleSubmit = (e: React.FormEvent) => {
    e.preventDefault()
    if (!email.trim()) return
    addMember.mutate({
      developerAccountId,
      emailAddress: email.trim(),
      accessLevel,
    })
  }

  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent className='sm:max-w-md'>
        <form onSubmit={handleSubmit}>
          <DialogHeader>
            <DialogTitle>Add Member</DialogTitle>
            <DialogDescription>
              Add an existing user to this developer account by their email address.
            </DialogDescription>
          </DialogHeader>

          <div className='grid gap-4 py-4'>
            <div className='grid gap-2'>
              <Label htmlFor='email'>Email address</Label>
              <Input
                id='email'
                type='email'
                placeholder='user@example.com'
                value={email}
                onChange={(e) => setEmail(e.target.value)}
                required
              />
            </div>

            <div className='grid gap-2'>
              <Label htmlFor='role'>Role</Label>
              <Select
                value={accessLevel}
                onValueChange={(v) => setAccessLevel(v as 'member' | 'admin')}>
                <SelectTrigger id='role'>
                  <SelectValue />
                </SelectTrigger>
                <SelectContent>
                  <SelectItem value='member'>Member</SelectItem>
                  <SelectItem value='admin'>Admin</SelectItem>
                </SelectContent>
              </Select>
            </div>
          </div>

          <DialogFooter>
            <Button type='button' variant='outline' onClick={() => onOpenChange(false)}>
              Cancel
            </Button>
            <Button type='submit' loading={addMember.isPending} loadingText='Adding...'>
              Add Member
            </Button>
          </DialogFooter>
        </form>
      </DialogContent>
    </Dialog>
  )
}
