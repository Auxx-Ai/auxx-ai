// apps/web/src/components/mail-filters/ui/mail-filter-runs-dialog.tsx

'use client'

import type { MailFilterRow, MailFilterRunRow } from '@auxx/lib/mail-filters/client'
import { Button } from '@auxx/ui/components/button'
import { toastError } from '@auxx/ui/components/toast'
import { formatDistanceToNow } from 'date-fns'
import { Undo2 } from 'lucide-react'
import { RuleRunsDialog } from '~/components/rules/ui/rule-runs-dialog'
import { api } from '~/trpc/react'

interface MailFilterRunsDialogProps {
  filter: MailFilterRow
  open: boolean
  onClose: () => void
}

/**
 * Recent firings of one mail filter with per-action outcomes — the debugging
 * view, through the shared {@link RuleRunsDialog}.
 *
 * ⚠️ `MailFilterRun.undo` is NULLABLE and a null must be read as **"not
 * reversible"**, never as "there was nothing to reverse". The run row is
 * inserted as a claim BEFORE the actions execute (§3, invariant 4) and `undo` is
 * written by the post-execution UPDATE — so a run that died mid-execution has a
 * `status` but no undo blob, and its thread may well have been mutated. Telling
 * the user "nothing to undo" there would be the opposite of the truth, so the
 * copy says the state was never recorded and the changes still stand.
 */
export function MailFilterRunsDialog({ filter, open, onClose }: MailFilterRunsDialogProps) {
  const utils = api.useUtils()
  const {
    data: runs,
    isLoading,
    isFetching,
  } = api.mailFilters.runs.useQuery({ filterId: filter.id }, { enabled: open })

  const undoRun = api.mailFilters.undoRun.useMutation({
    onSuccess: () => utils.mailFilters.runs.invalidate({ filterId: filter.id }),
    onError: (error) => toastError({ title: 'Error reversing run', description: error.message }),
  })

  return (
    <RuleRunsDialog
      open={open}
      onClose={onClose}
      name={filter.name}
      runs={runs}
      isLoading={isLoading}
      emptyText='This filter has not fired yet.'
      renderExtraColumns={(run: MailFilterRunRow) => {
        if (run.undoneAt) {
          return (
            <p className='mt-1 text-muted-foreground'>
              Reversed {formatDistanceToNow(run.undoneAt, { addSuffix: true })}
            </p>
          )
        }
        if (run.undo === null) {
          return (
            <p className='mt-1 text-muted-foreground'>
              Not reversible. This firing never recorded the conversation’s previous state, so it
              cannot be rolled back. Anything it did change is still in place.
            </p>
          )
        }
        return (
          <div className='mt-1'>
            <Button
              variant='outline'
              size='xs'
              loading={undoRun.isPending && undoRun.variables?.runId === run.id}
              loadingText='Reversing...'
              disabled={isFetching}
              onClick={() => undoRun.mutate({ runId: run.id })}>
              <Undo2 />
              Undo this firing
            </Button>
          </div>
        )
      }}
    />
  )
}
