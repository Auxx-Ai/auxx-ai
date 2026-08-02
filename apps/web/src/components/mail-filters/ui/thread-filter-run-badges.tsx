// apps/web/src/components/mail-filters/ui/thread-filter-run-badges.tsx

'use client'

import { MAIL_FILTER_ACTION_LABELS, type MailFilterRunRow } from '@auxx/lib/mail-filters/client'
import { Badge } from '@auxx/ui/components/badge'
import { Button } from '@auxx/ui/components/button'
import { Popover, PopoverContent, PopoverTrigger } from '@auxx/ui/components/popover'
import { toastError } from '@auxx/ui/components/toast'
import { formatDistanceToNow } from 'date-fns'
import { Filter, Undo2 } from 'lucide-react'
import Link from 'next/link'
import { api } from '~/trpc/react'
import { useAuthorableInboxes } from '../hooks/use-authorable-inboxes'

/** One firing on this thread, plus the name of the filter that produced it. */
type ThreadFilterRun = MailFilterRunRow & { filterName: string }

interface ThreadFilterRunBadgesProps {
  threadId: string
}

/**
 * "Filtered by *Newsletters*" chips on the thread header, with Undo (D9, §6.3).
 *
 * **One chip per firing**, not per filter and not one summary chip: several
 * filters can match the same message, each writes its own `MailFilterRun`, and
 * each is reversed independently — so collapsing them would leave no way to undo
 * just the one that got it wrong.
 *
 * `api.mailFilters.threadRuns` scopes to the caller's authorable inboxes, so a
 * chip is only ever shown to someone who could also reverse it.
 */
export function ThreadFilterRunBadges({ threadId }: ThreadFilterRunBadgesProps) {
  // The router already returns `[]` for a caller who may author nowhere, but
  // checking the (shared, cached) authorable set first means a thread opened in
  // an org with no filter authorship costs no extra round trip at all — and this
  // component mounts on every thread.
  const { canAuthorAny } = useAuthorableInboxes()
  const { data: runs } = api.mailFilters.threadRuns.useQuery(
    { threadId },
    { enabled: canAuthorAny, staleTime: 30_000 }
  )
  if (!runs || runs.length === 0) return null

  return (
    <div className='flex flex-wrap items-center gap-1.5 py-1'>
      {runs.map((run) => (
        <ThreadFilterRunChip key={run.id} run={run} threadId={threadId} />
      ))}
    </div>
  )
}

function ThreadFilterRunChip({ run, threadId }: { run: ThreadFilterRun; threadId: string }) {
  const utils = api.useUtils()

  const undoRun = api.mailFilters.undoRun.useMutation({
    onSuccess: (result) => {
      void utils.mailFilters.threadRuns.invalidate({ threadId })
      /**
       * ⚠️ Never report a clean success when fields were skipped.
       *
       * `undoMailFilterRun` is continue-and-report: it reverses what it can and
       * names what it could not. Swallowing `skipped` would tell the user their
       * conversation was restored while part of it demonstrably was not — and
       * the house rule (error toasts only) is exactly right here, because a
       * partial reversal IS the failure worth interrupting for.
       */
      if (result.skipped.length > 0) {
        toastError({
          title: `Partly reversed “${run.filterName}”`,
          description: result.skipped.map((entry) => `${entry.field}: ${entry.reason}`).join(' · '),
        })
      }
    },
    onError: (error) => toastError({ title: 'Error reversing filter', description: error.message }),
  })

  const undoneAt = run.undoneAt
  // ⚠️ NULL `undo` is "not reversible", never "nothing to undo". The run row is
  // inserted as a claim BEFORE the actions execute (§3, invariant 4) and the
  // blob is written by the post-execution UPDATE — so a run that died
  // mid-execution has a status, no blob, and a thread that may well have been
  // mutated. Copy matches `MailFilterRunsDialog`.
  const isReversible = run.undo !== null

  return (
    <Popover>
      <PopoverTrigger asChild>
        <Badge
          asChild
          variant={undoneAt ? 'outline' : 'default'}
          className='h-5 cursor-pointer px-1.5 py-0'>
          <button type='button'>
            <Filter className='size-3' />
            <span className='max-w-40 truncate'>
              {undoneAt ? 'Reversed' : 'Filtered'} by {run.filterName}
            </span>
          </button>
        </Badge>
      </PopoverTrigger>
      <PopoverContent align='start' className='w-80 space-y-2 p-3 text-sm'>
        <div>
          <p className='font-medium'>{run.filterName}</p>
          <p className='text-xs text-muted-foreground'>
            {run.source === 'retroactive' ? 'Applied to existing mail' : 'Fired'}{' '}
            {formatDistanceToNow(run.firedAt, { addSuffix: true })}
            {run.status === 'ok' ? '' : ` · ${run.status}`}
          </p>
        </div>

        {run.outcomes.length > 0 && (
          <ul className='space-y-0.5 text-xs text-muted-foreground'>
            {run.outcomes.map((outcome, index) => (
              <li key={`${outcome.type}-${index}`}>
                {MAIL_FILTER_ACTION_LABELS[outcome.type] ?? outcome.type}: {outcome.status}
                {outcome.error ? `: ${outcome.error}` : ''}
              </li>
            ))}
          </ul>
        )}

        {undoneAt ? (
          <p className='text-xs text-muted-foreground'>
            Reversed {formatDistanceToNow(undoneAt, { addSuffix: true })}.
          </p>
        ) : isReversible ? (
          <Button
            variant='outline'
            size='xs'
            loading={undoRun.isPending}
            loadingText='Reversing...'
            onClick={() => undoRun.mutate({ runId: run.id })}>
            <Undo2 />
            Undo this firing
          </Button>
        ) : (
          <p className='text-xs text-muted-foreground'>
            Not reversible. This firing never recorded the conversation’s previous state, so it
            cannot be rolled back. Anything it did change is still in place.
          </p>
        )}

        <Link
          href='/app/settings/rules'
          className='block text-xs text-muted-foreground underline underline-offset-2'>
          Manage mail filters
        </Link>
      </PopoverContent>
    </Popover>
  )
}
