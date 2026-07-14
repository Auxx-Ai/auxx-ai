// apps/web/src/components/sequences/ui/detail/sequence-enroll-dialog.tsx
'use client'

import type { RecordId } from '@auxx/lib/resources/client'
import { SEQUENCE_ENROLL_MAX_RECIPIENTS } from '@auxx/lib/sequences/client'
import { getInstanceId, toRecordId } from '@auxx/types/resource'
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
import { toastError } from '@auxx/ui/components/toast'
import { CheckCircle2, XCircle } from 'lucide-react'
import { useEffect, useState } from 'react'
import { RecordPickerContent } from '~/components/pickers/record-picker/record-picker-content'
import { RecordBadge } from '~/components/resources/ui/record-badge'
import { api } from '~/trpc/react'

interface SequenceEnrollDialogProps {
  sequenceId: string
  open: boolean
  onOpenChange: (open: boolean) => void
}

type EnrollResult = { recipientId: string; status: 'enrolled' | 'skipped'; reason?: string }

/**
 * "Enroll contacts" dialog: a multi-select contact record picker (≤50 per
 * enroll action, plan §15) followed by an inline per-recipient result view —
 * suppressed / already-active / no-email contacts come back as skips with
 * reasons, shown before the dialog closes.
 */
export function SequenceEnrollDialog({
  sequenceId,
  open,
  onOpenChange,
}: SequenceEnrollDialogProps) {
  const utils = api.useUtils()
  const [selected, setSelected] = useState<RecordId[]>([])
  const [results, setResults] = useState<EnrollResult[] | null>(null)

  // Fresh state on every open.
  useEffect(() => {
    if (open) {
      setSelected([])
      setResults(null)
    }
  }, [open])

  const enroll = api.sequence.enroll.useMutation({
    onSuccess: (outcomes: EnrollResult[]) => {
      utils.sequence.listRuns.invalidate({ sequenceId })
      utils.sequence.stats.invalidate({ sequenceId })
      const skipped = outcomes.filter((o) => o.status === 'skipped')
      if (skipped.length === 0) {
        onOpenChange(false)
      } else {
        setResults(outcomes)
      }
    },
    onError: (error) =>
      toastError({ title: 'Failed to enroll contacts', description: error.message }),
  })

  const overLimit = selected.length > SEQUENCE_ENROLL_MAX_RECIPIENTS
  const enrolledCount = results?.filter((r) => r.status === 'enrolled').length ?? 0
  const skipped = results?.filter((r) => r.status === 'skipped') ?? []

  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent className='sm:max-w-md'>
        <DialogHeader>
          <DialogTitle>Enroll contacts</DialogTitle>
          <DialogDescription>
            {results
              ? `${enrolledCount} enrolled, ${skipped.length} skipped.`
              : `Pick up to ${SEQUENCE_ENROLL_MAX_RECIPIENTS} contacts to enroll in this sequence.`}
          </DialogDescription>
        </DialogHeader>

        {results ? (
          <div className='flex max-h-72 flex-col gap-1 overflow-y-auto'>
            {enrolledCount > 0 && (
              <div className='flex items-center gap-2 text-sm text-muted-foreground'>
                <CheckCircle2 className='size-4 text-good-500' />
                {enrolledCount} contact{enrolledCount === 1 ? '' : 's'} enrolled
              </div>
            )}
            {skipped.map((result) => (
              <div key={result.recipientId} className='flex items-center gap-2 text-sm'>
                <XCircle className='size-4 shrink-0 text-bad-500' />
                <RecordBadge recordId={toRecordId('contact', result.recipientId)} />
                <span className='truncate text-xs text-muted-foreground'>
                  {result.reason ?? 'Skipped'}
                </span>
              </div>
            ))}
          </div>
        ) : (
          <div className='rounded-md border'>
            <RecordPickerContent
              value={selected}
              onChange={setSelected}
              entityDefinitionId='contact'
              multi
              placeholder='Search contacts…'
            />
            {overLimit && (
              <div className='border-t px-3 py-1.5 text-xs text-bad-500'>
                Up to {SEQUENCE_ENROLL_MAX_RECIPIENTS} contacts per enroll action — remove{' '}
                {selected.length - SEQUENCE_ENROLL_MAX_RECIPIENTS} to continue.
              </div>
            )}
          </div>
        )}

        <DialogFooter>
          <Button
            type='button'
            variant='ghost'
            size='sm'
            onClick={() => onOpenChange(false)}
            disabled={enroll.isPending}>
            {results ? 'Close' : 'Cancel'} <Kbd shortcut='esc' variant='ghost' size='sm' />
          </Button>
          {!results && (
            <Button
              variant='outline'
              size='sm'
              loading={enroll.isPending}
              loadingText='Enrolling…'
              disabled={selected.length === 0 || overLimit}
              onClick={() =>
                enroll.mutate({
                  sequenceId,
                  recipientEntityInstanceIds: selected.map((id) => getInstanceId(id)),
                })
              }
              data-dialog-submit>
              Enroll {selected.length > 0 ? selected.length : ''}{' '}
              <KbdSubmit variant='outline' size='sm' />
            </Button>
          )}
        </DialogFooter>
      </DialogContent>
    </Dialog>
  )
}
