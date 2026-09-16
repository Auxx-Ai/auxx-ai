// apps/web/src/components/accounting/ui/ledger/sidebar/sync-queue-group.tsx

'use client'

import type { SyncQueueRow } from '@auxx/lib/postings/client'
import { Button } from '@auxx/ui/components/button'
import { SidebarGroup, SidebarGroupLabel } from '@auxx/ui/components/sidebar'
import { RefreshCw } from 'lucide-react'
import {
  syncQueueRailSentence,
  tallySyncQueue,
} from '~/components/accounting/ui/ledger/sync-queue/sync-queue-rows'

interface SyncQueueGroupProps {
  rows: SyncQueueRow[] | undefined
  /** The read's own failure, or `null`. */
  error: string | null
  /** 🔌 Never a vendor name. `UNKNOWN_PROVIDER_LABEL` when nothing is connected. */
  providerLabel: string
  /** The queue panel is the thing on screen. */
  isOpen: boolean
  onOpen: () => void
  onClose: () => void
}

/**
 * The door to the sync queue (53 §7.2.4, D17): a group in the ledger's module
 * rail, alongside `CloseMonthGroup`, `RailFeesGroup`, `BooksGroup` and
 * `ThisMonthGroup` - **not** a second route. `GlPosting` is already the
 * aggregate, so an exports page would show the same rows with other columns.
 *
 * 🛑 **Not an alarm.** Once the hold is on, every entry the organization posts
 * rests here, so "12 ready to sync" is the ordinary reading of a healthy ledger
 * and this group must not dress it as a backlog. It follows `RailFeesGroup`'s
 * rule: a count and a verb, and the person draws the conclusion. Only a REFUSAL
 * gets a colour, because only a refusal is somebody's problem.
 *
 * ⚠️ It renders NOTHING when the queue is empty and it is not the thing on
 * screen - the same rule `BooksGroup` keeps. A rail group whose content reads
 * the same every day teaches people to stop looking at the rail.
 *
 * ⚠️ `py-2` + `h-8` is `/app/settings`' group spacing - see
 * `close-month-group.tsx` for why `SidebarGroup` gives none on its own.
 */
export function SyncQueueGroup({
  rows,
  error,
  providerLabel,
  isOpen,
  onOpen,
  onClose,
}: SyncQueueGroupProps) {
  if (error) {
    return (
      <SidebarGroup className='py-2'>
        <SidebarGroupLabel className='h-8'>Sync</SidebarGroupLabel>
        <p className='px-2 pb-1 text-destructive text-xs'>
          What is waiting to be synced could not be read. {error}
        </p>
      </SidebarGroup>
    )
  }

  const tally = tallySyncQueue(rows)
  // In flight, or nothing to say. A heading over an empty queue would be a claim
  // about a read that has not answered yet.
  if (!rows || (tally.total === 0 && !isOpen)) return null

  const sentence = syncQueueRailSentence(tally, providerLabel)

  return (
    <SidebarGroup className='py-2'>
      <SidebarGroupLabel className='h-8'>Sync</SidebarGroupLabel>
      <div className='flex flex-col gap-2 px-2 pb-1'>
        <Button
          variant={isOpen ? 'secondary' : 'outline'}
          size='sm'
          className='w-full justify-start'
          onClick={isOpen ? onClose : onOpen}>
          <RefreshCw />
          {isOpen ? 'Back to the month' : 'Sync queue'}
        </Button>

        {sentence && <p className='text-muted-foreground text-xs'>{sentence}</p>}

        {/* 🛑 The ONLY line here that carries a colour. Held entries are the
            hold working; a refusal is the provider having said no, and it is
            the one thing in this group somebody has to do something about. */}
        {tally.failed > 0 && (
          <p className='text-amber-600 text-xs'>
            {tally.failed === 1 ? 'One entry was' : `${tally.failed} entries were`} refused. The
            reason each one gave is on its row.
          </p>
        )}

        <p className='text-muted-foreground text-xs'>
          Every period, not just the month above. Entries stay in your books either way.
        </p>
      </div>
    </SidebarGroup>
  )
}
