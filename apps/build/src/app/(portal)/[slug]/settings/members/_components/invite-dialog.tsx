// apps/build/src/app/(portal)/[slug]/settings/members/_components/invite-dialog.tsx

'use client'

import { Button } from '@auxx/ui/components/button'
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogFooter,
  DialogHeader,
  DialogTitle,
  DialogTrigger,
} from '@auxx/ui/components/dialog'
import { Textarea } from '@auxx/ui/components/textarea'
import { Plus } from 'lucide-react'
import { useState } from 'react'
import { toastError } from '~/components/global/toast'
import { api } from '~/trpc/react'
import { AccessLevelSelect } from './access-level-select'

interface InviteDialogProps {
  developerSlug: string
}

export function InviteDialog({ developerSlug }: InviteDialogProps) {
  const [open, setOpen] = useState(false)
  const [emails, setEmails] = useState('')
  const [accessLevel, setAccessLevel] = useState<'admin' | 'member'>('member')
  const [validationError, setValidationError] = useState<string | null>(null)
  const utils = api.useUtils()

  const invite = api.members.invite.useMutation({
    onSuccess: (data) => {
      setOpen(false)
      setEmails('')
      setAccessLevel('member')
      setValidationError(null)
      utils.members.list.invalidate({ developerSlug })
    },
    onError: (error) => {
      toastError({ title: 'Failed to send invitations', description: error.message })
    },
  })

  const handleSubmit = () => {
    setValidationError(null)

    const trimmed = emails.trim()
    if (!trimmed) {
      setValidationError('Please enter at least one email address')
      return
    }

    // Quick client-side validation
    const parsed = trimmed
      .split(',')
      .map((e) => e.trim())
      .filter(Boolean)
    const emailRegex = /^[^\s@]+@[^\s@]+\.[^\s@]+$/
    const invalid = parsed.filter((e) => !emailRegex.test(e))

    if (invalid.length > 0) {
      setValidationError(`Invalid email addresses: ${invalid.join(', ')}`)
      return
    }

    invite.mutate({ developerSlug, emails: trimmed, accessLevel })
  }

  return (
    <Dialog open={open} onOpenChange={setOpen}>
      <DialogTrigger asChild>
        <Button size='sm'>
          <Plus />
          Invite team members
        </Button>
      </DialogTrigger>
      <DialogContent>
        <DialogHeader>
          <DialogTitle>Invite team members</DialogTitle>
          <DialogDescription>
            Enter email addresses separated by commas to invite multiple people at once.
          </DialogDescription>
        </DialogHeader>

        <div className='space-y-4'>
          <div className='space-y-2'>
            <label htmlFor='invite-emails' className='text-sm font-medium'>
              Email addresses
            </label>
            <Textarea
              id='invite-emails'
              placeholder='alice@example.com, bob@example.com'
              value={emails}
              onChange={(e) => {
                setEmails(e.target.value)
                setValidationError(null)
              }}
              rows={3}
            />
            {validationError && <p className='text-sm text-destructive'>{validationError}</p>}
          </div>

          <div className='space-y-2'>
            <label className='text-sm font-medium'>Access level</label>
            <AccessLevelSelect value={accessLevel} onValueChange={setAccessLevel} />
            <p className='text-xs text-muted-foreground'>
              {accessLevel === 'admin'
                ? 'Admins can manage members and account settings.'
                : 'Members have standard access to the developer account.'}
            </p>
          </div>
        </div>

        <DialogFooter>
          <Button variant='ghost' size='sm' onClick={() => setOpen(false)}>
            Cancel
          </Button>
          <Button
            size='sm'
            onClick={handleSubmit}
            loading={invite.isPending}
            loadingText='Sending...'>
            Send invitations
          </Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  )
}
