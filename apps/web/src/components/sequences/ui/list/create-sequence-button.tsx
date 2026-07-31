// apps/web/src/components/sequences/ui/list/create-sequence-button.tsx
'use client'

import { FeatureKey } from '@auxx/lib/permissions/client'
import {
  SEQUENCE_TRIGGER_LABELS,
  SEQUENCE_TRIGGER_TYPES,
  type SequenceTriggerType,
} from '@auxx/lib/sequences/client'
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
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from '@auxx/ui/components/select'
import { toastError } from '@auxx/ui/components/toast'
import { MailPlus, Plus } from 'lucide-react'
import { useRouter } from 'next/navigation'
import { useRef, useState } from 'react'
import { LimitReachedDialog } from '~/components/subscriptions/limit-reached-dialog'
import { useFeatureFlags } from '~/providers/feature-flag-provider'
import { api } from '~/trpc/react'

/**
 * Header action for the Sequences tab: "New sequence" button + a minimal
 * create dialog (name + trigger — everything else is set on the detail
 * page). `triggerType` derives `subjectKind` server-side (plan §4.7).
 * Navigates to the sequence detail route on success.
 */
export function CreateSequenceButton() {
  const router = useRouter()
  const utils = api.useUtils()
  const [open, setOpen] = useState(false)
  const [limitDialogOpen, setLimitDialogOpen] = useState(false)
  const [name, setName] = useState('')
  const [triggerType, setTriggerType] = useState<SequenceTriggerType>('manual')
  const nameInputRef = useRef<HTMLInputElement>(null)
  const { isAtLimit, getLimit } = useFeatureFlags()

  // Same query the list uses (React Query dedupes it). Seeded templates are
  // filtered out to match `countSequencesUsed` on the server — they are
  // undeletable, so counting them here would show a limit the user cannot act on.
  const sequences = api.sequence.list.useQuery()
  const used = sequences.data?.filter((s) => !s.templateKey).length ?? 0
  const atLimit = isAtLimit(FeatureKey.sequencesLimit, used)
  const sequenceLimit = getLimit(FeatureKey.sequencesLimit)

  const createSequence = api.sequence.create.useMutation({
    onSuccess: (created) => {
      setOpen(false)
      setName('')
      setTriggerType('manual')
      void utils.sequence.list.invalidate()
      if (created?.id) router.push(`/app/workflows/sequences/${created.id}`)
    },
    onError: (error) => {
      toastError({ title: 'Failed to create sequence', description: error.message })
    },
  })

  const handleOpenChange = (next: boolean) => {
    setOpen(next)
    if (!next) {
      setName('')
      setTriggerType('manual')
    }
  }

  const handleSubmit = (e: React.FormEvent) => {
    e.preventDefault()
    const trimmed = name.trim()
    if (!trimmed) {
      toastError({ title: 'Name required', description: 'Please enter a sequence name' })
      return
    }
    createSequence.mutate({ name: trimmed, triggerType })
  }

  if (atLimit) {
    return (
      <>
        <Button size='sm' onClick={() => setLimitDialogOpen(true)}>
          <Plus />
          New sequence
        </Button>
        <LimitReachedDialog
          open={limitDialogOpen}
          onOpenChange={setLimitDialogOpen}
          icon={MailPlus}
          title='Sequence Limit Reached'
          description={`You've reached the maximum of ${sequenceLimit} sequences on your current plan.`}
        />
      </>
    )
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

            <div className='mt-3 grid gap-2'>
              <Label htmlFor='sequence-trigger'>Trigger</Label>
              <Select
                value={triggerType}
                onValueChange={(v) => setTriggerType(v as SequenceTriggerType)}
                disabled={createSequence.isPending}>
                <SelectTrigger id='sequence-trigger' className='w-full'>
                  <SelectValue />
                </SelectTrigger>
                <SelectContent>
                  {SEQUENCE_TRIGGER_TYPES.map((t) => (
                    <SelectItem key={t} value={t}>
                      {SEQUENCE_TRIGGER_LABELS[t]}
                    </SelectItem>
                  ))}
                </SelectContent>
              </Select>
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
