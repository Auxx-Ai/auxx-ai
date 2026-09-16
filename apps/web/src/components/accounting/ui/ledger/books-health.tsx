// apps/web/src/components/accounting/ui/ledger/books-health.tsx
//
// 🛑 What is LEFT here is the refusal banner, and that is the whole file now.
// It used to also render the balance sweep's findings, the month's completeness
// lines and the duplicate-movement cards, all three for the module rail's Books
// group. That group is gone (`ledger-sidebar.tsx`): the standing balance answer
// is on the stats strip, the completeness counts are the close's own refusals
// (`entry-blockers.tsx`), and the duplicate detector is a question Kopilot
// answers on this page through `get_ledger_status`. A refused export is
// different in kind - it is outstanding work with a button on it - which is why
// it stayed on the page.

'use client'

import type { SyncQueueRow } from '@auxx/lib/postings/client'
import { Alert, AlertDescription, AlertTitle } from '@auxx/ui/components/alert'
import { Button } from '@auxx/ui/components/button'
import { CircleAlert, RefreshCw } from 'lucide-react'
import { refusedReasonSummary } from './sync-queue/sync-queue-rows'

interface FailedExportsBannerProps {
  /** ONLY refused rows. Held and in-flight ones belong in the sync queue. */
  exports: SyncQueueRow[]
  /** 🔌 Never a vendor name. `UNKNOWN_PROVIDER_LABEL` when nothing is connected. */
  providerLabel: string
  /** Opens the sync queue view, where the rest of the outstanding copies live. */
  onOpenSyncQueue: () => void
}

/**
 * Entries that ARE in the books and that the provider REFUSED - as a COUNT.
 *
 * 🛑 **Refusals only** (53 §7.2.2). This banner used to list every `pending`
 * row as well, which was right while `pending` meant "in flight": the hold was
 * off, so a row resting there was a push that had not answered. With the hold ON
 * (`quickbooks.postJournalEntries` off) `pending` becomes the resting state of
 * every entry the organization posts, and a banner listing all of them would be
 * permanently open, permanently long, and permanently wrong about what it was
 * reporting - a healthy hold rendered as forty problems. Held entries are the
 * SYNC QUEUE's, reached from the rail.
 *
 * 🛑 **And a SUMMARY, not a list - which is the next step of the same
 * argument.** "Refusals only" is still 28 rows when 28 entries name an unmapped
 * account, and 28 identical amber cards - each with its own badge, period, doc
 * number, attempt count, Sync button and the same two sentences repeated
 * verbatim - buries the ledger the banner sits on top of. 🔑 This is D17
 * applied to the banner: the sync queue is ONE list, and a banner that
 * enumerates the same rows is a second list of them. The queue is where a row
 * gets acted on; this says how many there are and points at it. No per-row
 * card, no per-row Sync.
 *
 * 🛑 The wording matters. These entries are NOT missing from the statements -
 * they are in the books and it is the COPY that is outstanding. See
 * plans/accounting/export-state-split.md.
 *
 * ⚠️ Nothing is filtered by period, and nothing needs to be any more: with no
 * rows rendered there is no `periodKey` to format, which also retires the old
 * caveat about `periodMonth` throwing on the keys `GlPosting` permits.
 */
export function FailedExportsBanner({
  exports: refused,
  providerLabel,
  onOpenSyncQueue,
}: FailedExportsBannerProps) {
  if (refused.length === 0) return null

  return (
    <Alert variant='warning'>
      <CircleAlert />
      <AlertTitle className='flex-wrap'>
        {providerLabel} refused {refused.length} {refused.length === 1 ? 'entry' : 'entries'}. They
        are still in your books
      </AlertTitle>
      {/* Summarised, never enumerated. One shared reason is quoted once -
          that is the common case, because a role nobody mapped refuses every
          entry that uses it - and anything more becomes a count, since the
          remedy is per row and the row is in the queue. */}
      <AlertDescription>{refusedReasonSummary(refused)}</AlertDescription>

      <div className='mt-2'>
        <Button variant='outline' size='sm' onClick={onOpenSyncQueue}>
          <RefreshCw />
          Open the sync queue
        </Button>
      </div>
    </Alert>
  )
}
