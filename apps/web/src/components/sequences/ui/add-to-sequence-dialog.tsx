// apps/web/src/components/sequences/ui/add-to-sequence-dialog.tsx
'use client'

import { FeatureKey } from '@auxx/lib/permissions/client'
import { SEQUENCE_ENROLL_MAX_RECIPIENTS } from '@auxx/lib/sequences/client'
import { Badge } from '@auxx/ui/components/badge'
import { Button } from '@auxx/ui/components/button'
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogFooter,
  DialogHeader,
  DialogTitle,
} from '@auxx/ui/components/dialog'
import { Kbd, KbdSubmit } from '@auxx/ui/components/kbd'
import { ScrollArea } from '@auxx/ui/components/scroll-area'
import { toastError } from '@auxx/ui/components/toast'
import { cn } from '@auxx/ui/lib/utils'
import { CircleAlert, SendHorizonal, TriangleAlert } from 'lucide-react'
import { useEffect, useState } from 'react'
import { useFeatureFlags } from '~/providers/feature-flag-provider'
import { api } from '~/trpc/react'

interface AddToSequenceDialogProps {
  open: boolean
  onOpenChange: (open: boolean) => void
  /** Contact entity instance ids to enroll — capped at `SEQUENCE_ENROLL_MAX_RECIPIENTS`. */
  recipientEntityInstanceIds: string[]
}

/**
 * A single selectable sequence row — plain button + conditional highlight
 * (mirrors `LinkThreadDialog`'s row pattern; `TreeRow`'s `isOpen`/`onToggleOpen`
 * is expand/collapse semantics, not radio-select, so it doesn't fit here).
 */
function SequenceOptionRow({
  name,
  description,
  selected,
  onClick,
}: {
  name: string
  description?: string | null
  selected: boolean
  onClick: () => void
}) {
  return (
    <button
      type='button'
      onClick={onClick}
      className={cn(
        'w-full cursor-pointer rounded-lg border p-3 text-left transition-colors',
        selected ? 'border-info bg-info/5 ring-1 ring-info' : 'border-border hover:bg-accent'
      )}>
      <div className='flex items-center gap-2'>
        <SendHorizonal className='size-4 shrink-0 text-muted-foreground' />
        <span className='truncate text-sm font-medium'>{name}</span>
      </div>
      {description && (
        <p className='mt-1 line-clamp-1 text-xs text-muted-foreground'>{description}</p>
      )}
    </button>
  )
}

/**
 * Dialog for enrolling one or more contacts into a sequence — the shared body
 * behind the contact detail "Add to sequence" action and the contacts list
 * bulk action (Sequences plan §17). Only enabled + published sequences are
 * eligible (`status==='enabled' && publishedAt`). After enroll, shows
 * per-recipient results inline when any were skipped; otherwise closes.
 */
export function AddToSequenceDialog({
  open,
  onOpenChange,
  recipientEntityInstanceIds,
}: AddToSequenceDialogProps) {
  const { hasAccess } = useFeatureFlags()
  const sequencesEnabled = hasAccess(FeatureKey.sequences)
  const [selectedSequenceId, setSelectedSequenceId] = useState<string | null>(null)
  const [results, setResults] = useState<
    { recipientId: string; status: 'enrolled' | 'skipped'; reason?: string }[] | null
  >(null)

  const overCap = recipientEntityInstanceIds.length > SEQUENCE_ENROLL_MAX_RECIPIENTS

  const sequences = api.sequence.list.useQuery(undefined, {
    enabled: sequencesEnabled && open && !overCap,
  })
  const eligible = (sequences.data ?? []).filter((s) => s.status === 'enabled' && s.publishedAt)

  const enroll = api.sequence.enroll.useMutation({
    onSuccess: (data) => {
      const skipped = data.filter((r) => r.status === 'skipped')
      if (skipped.length > 0) {
        setResults(data)
      } else {
        onOpenChange(false)
      }
    },
    onError: (error) => {
      toastError({ title: 'Failed to enroll recipients', description: error.message })
    },
  })

  // Reset local state whenever the dialog opens fresh.
  useEffect(() => {
    if (open) {
      setSelectedSequenceId(null)
      setResults(null)
    }
  }, [open])

  if (!sequencesEnabled) return null

  const handleEnroll = () => {
    if (!selectedSequenceId) return
    enroll.mutate({
      sequenceId: selectedSequenceId,
      recipientEntityInstanceIds,
    })
  }

  const recipientCount = recipientEntityInstanceIds.length

  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent size='sm' position='tc'>
        <DialogHeader>
          <DialogTitle>Add to sequence</DialogTitle>
          {!overCap && !results && (
            <DialogDescription>
              Enroll {recipientCount} contact{recipientCount === 1 ? '' : 's'} into a published
              sequence.
            </DialogDescription>
          )}
        </DialogHeader>

        {overCap ? (
          <div className='flex items-start gap-2 rounded-lg border border-destructive/30 bg-destructive/5 p-3 text-sm text-destructive'>
            <CircleAlert className='mt-0.5 size-4 shrink-0' />
            <span>
              You selected {recipientCount} contacts — enrolling is capped at{' '}
              {SEQUENCE_ENROLL_MAX_RECIPIENTS} per action. Select fewer contacts and try again.
            </span>
          </div>
        ) : results ? (
          <ScrollArea className='max-h-80'>
            <div className='flex flex-col gap-2 pr-2'>
              {results.map((r) => (
                <div
                  key={r.recipientId}
                  className='flex items-start justify-between gap-2 rounded-lg border p-2 text-sm'>
                  <span className='truncate text-muted-foreground'>{r.recipientId}</span>
                  {r.status === 'skipped' ? (
                    <Badge variant='amber' size='sm' className='shrink-0'>
                      <TriangleAlert />
                      {r.reason ?? 'Skipped'}
                    </Badge>
                  ) : (
                    <Badge variant='green' size='sm' className='shrink-0'>
                      Enrolled
                    </Badge>
                  )}
                </div>
              ))}
            </div>
          </ScrollArea>
        ) : sequences.isLoading ? (
          <div className='text-sm text-muted-foreground'>Loading sequences...</div>
        ) : eligible.length === 0 ? (
          <div className='text-sm text-muted-foreground'>
            No published sequences yet. Publish a sequence before enrolling contacts.
          </div>
        ) : (
          <ScrollArea className='max-h-80'>
            <div className='flex flex-col gap-2 pr-2'>
              {eligible.map((sequence) => (
                <SequenceOptionRow
                  key={sequence.id}
                  name={sequence.name}
                  description={sequence.description}
                  selected={selectedSequenceId === sequence.id}
                  onClick={() =>
                    setSelectedSequenceId(sequence.id === selectedSequenceId ? null : sequence.id)
                  }
                />
              ))}
            </div>
          </ScrollArea>
        )}

        <DialogFooter>
          <Button
            type='button'
            variant='ghost'
            size='sm'
            onClick={() => onOpenChange(false)}
            disabled={enroll.isPending}>
            {results || overCap ? 'Close' : 'Cancel'}{' '}
            <Kbd shortcut='esc' variant='ghost' size='sm' />
          </Button>
          {!overCap && !results && (
            <Button
              type='button'
              variant='outline'
              size='sm'
              onClick={handleEnroll}
              disabled={!selectedSequenceId || eligible.length === 0}
              loading={enroll.isPending}
              loadingText='Enrolling...'
              data-dialog-submit>
              Enroll <KbdSubmit variant='outline' size='sm' />
            </Button>
          )}
        </DialogFooter>
      </DialogContent>
    </Dialog>
  )
}
