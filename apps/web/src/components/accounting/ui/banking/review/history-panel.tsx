// apps/web/src/components/accounting/ui/banking/review/history-panel.tsx

'use client'

import type { ReviewHistoryEntry } from '@auxx/lib/banking/review/client'
import { Badge } from '@auxx/ui/components/badge'
import { Skeleton } from '@auxx/ui/components/skeleton'
import { api } from '~/trpc/react'

interface HistoryPanelProps {
  transactionId: string
  /** Opens the ledger's posting drawer for a posting this line produced. */
  onOpenPosting?: (glPostingId: string) => void
}

/**
 * What happened to this line, oldest first: how it arrived, who decided, under
 * which rule, and what it posted (plans/accounting/ui-plan.md §2.8 item 7).
 *
 * ⚠️ The posting row is a LINK, not a copy of the entry. A bank line and its
 * journal entry are two records and the ledger's own drawer is the place an
 * entry is read; re-rendering the lines here would be a second view of the same
 * numbers that could drift from it.
 */
export function HistoryPanel({ transactionId, onOpenPosting }: HistoryPanelProps) {
  const history = api.bankingReview.history.useQuery({ id: transactionId })

  if (history.isPending) {
    return (
      <div className='flex flex-col gap-2'>
        <Skeleton className='h-8 w-full' />
        <Skeleton className='h-8 w-2/3' />
      </div>
    )
  }

  const entries = history.data ?? []
  if (entries.length === 0) {
    return <p className='text-muted-foreground text-sm'>Nothing has happened to this line yet.</p>
  }

  return (
    <ol className='flex flex-col gap-0'>
      {entries.map((entry: ReviewHistoryEntry, index) => (
        <li
          key={`${entry.kind}-${index}`}
          className='flex items-start gap-3 border-border border-l py-2 ps-4'>
          <div className='flex min-w-0 flex-1 flex-col gap-0.5'>
            <span className='text-sm'>{entry.label}</span>
            {entry.detail && (
              <span className='truncate text-muted-foreground text-xs'>{entry.detail}</span>
            )}
          </div>
          {entry.glPostingId && onOpenPosting && (
            <button
              type='button'
              className='shrink-0 font-mono text-xs underline-offset-2 hover:underline'
              onClick={() => onOpenPosting(entry.glPostingId as string)}>
              {entry.docNumber}
            </button>
          )}
          <Badge variant='outline' size='xs' className='shrink-0 font-mono'>
            {entry.at ? new Date(entry.at).toISOString().slice(0, 10) : '—'}
          </Badge>
        </li>
      ))}
    </ol>
  )
}
