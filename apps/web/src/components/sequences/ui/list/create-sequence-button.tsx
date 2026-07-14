// apps/web/src/components/sequences/ui/list/create-sequence-button.tsx
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
import { Kbd, KbdSubmit } from '@auxx/ui/components/kbd'
import { Label } from '@auxx/ui/components/label'
import { toastError } from '@auxx/ui/components/toast'
import { Plus } from 'lucide-react'
import { useRouter } from 'next/navigation'
import { useRef, useState } from 'react'
import { api } from '~/trpc/react'

/**
 * Header action for the Sequences tab: "New sequence" button + a minimal
 * create dialog (name only — everything else is set on the detail page).
 * Navigates to the sequence detail route on success.
 */
export function CreateSequenceButton() {
  const router = useRouter()
  const utils = api.useUtils()
  const [open, setOpen] = useState(false)
  const [name, setName] = useState('')
  const nameInputRef = useRef<HTMLInputElement>(null)

  const createSequence = api.sequence.create.useMutation({
    onSuccess: (created) => {
      setOpen(false)
      setName('')
      void utils.sequence.list.invalidate()
      if (created?.id) router.push(`/app/workflows/sequences/${created.id}`)
    },
    onError: (error) => {
      toastError({ title: 'Failed to create sequence', description: error.message })
    },
  })

  const handleOpenChange = (next: boolean) => {
    setOpen(next)
    if (!next) setName('')
  }

  const handleSubmit = (e: React.FormEvent) => {
    e.preventDefault()
    const trimmed = name.trim()
    if (!trimmed) {
      toastError({ title: 'Name required', description: 'Please enter a sequence name' })
      return
    }
    createSequence.mutate({ name: trimmed })
  }

  return (
    <>
      <Button size='sm' onClick={() => setOpen(true)}>
        <Plus />
        New sequence
      </Button>

      <Dialog open={open} onOpenChange={handleOpenChange}>
        <DialogContent
          size='sm'
          position='tc'
          onOpenAutoFocus={(e) => {
            e.preventDefault()
            nameInputRef.current?.focus()
          }}>
          <form onSubmit={handleSubmit}>
            <DialogHeader>
              <DialogTitle>New sequence</DialogTitle>
              <DialogDescription>
                Name it now — mailbox, steps, and delivery window are set on the sequence page.
              </DialogDescription>
            </DialogHeader>

            <div className='grid gap-2'>
              <Label htmlFor='sequence-name'>Name</Label>
              <Input
                ref={nameInputRef}
                id='sequence-name'
                autoComplete='off'
                value={name}
                onChange={(e) => setName(e.target.value)}
                placeholder='e.g. New lead follow-up'
                disabled={createSequence.isPending}
              />
            </div>

            <DialogFooter>
              <Button
                type='button'
                variant='ghost'
                size='sm'
                onClick={() => handleOpenChange(false)}
                disabled={createSequence.isPending}>
                Cancel <Kbd shortcut='esc' variant='ghost' size='sm' />
              </Button>
              <Button
                type='submit'
                variant='outline'
                size='sm'
                loading={createSequence.isPending}
                loadingText='Creating...'
                disabled={!name.trim()}
                data-dialog-submit>
                Create <KbdSubmit variant='outline' size='sm' />
              </Button>
            </DialogFooter>
          </form>
        </DialogContent>
      </Dialog>
    </>
  )
}
