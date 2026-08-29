// apps/web/src/components/accounting/ui/ledger/revision-strip.tsx

'use client'

import type { PostingDetail } from '@auxx/lib/postings/client'
import { Badge } from '@auxx/ui/components/badge'
import { Button } from '@auxx/ui/components/button'
import { cn } from '@auxx/ui/lib/utils'
import { History } from 'lucide-react'
import { formatAuditTimestamp } from './format'

/** One posting in a month's chain, as the strip renders it. */
export interface RevisionEntry {
  glPostingId: string
  revision: number
  status: PostingDetail['status']
  docNumber: string
  postedAt: string | null
}

/** Everything the strip needs from a `PostingDetail`, and nothing it does not. */
export function revisionEntryFromDetail(detail: PostingDetail): RevisionEntry {
  return {
    glPostingId: detail.id,
    revision: detail.revision,
    status: detail.status,
    docNumber: detail.docNumber,
    postedAt: detail.postedAt,
  }
}

interface RevisionStripProps {
  /**
   * The chain, newest revision first. `undefined` when the caller has no chain
   * to show - see the note below on the read that does not exist.
   */
  entries?: RevisionEntry[]
  activePostingId: string | null
  onSelect: (glPostingId: string) => void
  bookTimeZone: string
}

/**
 * The month's revision chain: revision 0 posted then reversed, revision 1 the
 * reversal, revision 2 the re-entry.
 *
 * 🛑 Renders ONLY when there is more than one posting to show. Under the L1
 * regime a month has exactly one effective entry, so a permanent list-of-one
 * would be chrome; the chain is the only thing a month genuinely has more than
 * one of (13-accounting-ui.md section 5.2).
 *
 * ⚠️ WAITING ON A READ THAT DOES NOT EXIST: a per-month chain list, something
 * like `ledger.revisions({ periodKey })`. `ledger.periods` returns only the
 * EFFECTIVE posting for a month, and the chain cannot be walked backwards from
 * it: `reverseEntry` sets `reversesId` on the REVERSAL, but a re-entry after a
 * reversal is an ordinary post and carries `reversesId: null`, so the newest
 * revision of a reversed-and-re-entered month points at nothing. Until that read
 * lands the caller can prove at most two links - a reversal and the posting it
 * reverses - and passes `undefined` the rest of the time rather than implying a
 * month was posted once when nobody has asked.
 *
 * Selecting a revision opens the posting drawer on it. That is what
 * `?posting=<id>` is for: a historical revision, not the primary read path.
 */
export function RevisionStrip({
  entries,
  activePostingId,
  onSelect,
  bookTimeZone,
}: RevisionStripProps) {
  if (!entries || entries.length < 2) return null

  return (
    <div className='flex flex-col gap-2 rounded-xl border bg-muted/30 p-3'>
      <div className='flex items-center gap-2 text-xs text-muted-foreground'>
        <History className='size-3.5' />
        <span>
          This month was posted more than once. The effective entry is the newest revision; the
          earlier ones are kept and reversed, never edited.
        </span>
      </div>
      <div className='flex flex-wrap gap-1.5'>
        {entries.map((entry) => (
          <Button
            key={entry.glPostingId}
            variant={entry.glPostingId === activePostingId ? 'secondary' : 'outline'}
            size='sm'
            className={cn('h-auto flex-col items-start gap-0.5 py-1.5')}
            onClick={() => onSelect(entry.glPostingId)}>
            <span className='flex items-center gap-1.5'>
              <span>Revision {entry.revision}</span>
              <Badge
                variant={entry.status === 'reversed' ? 'outline' : 'green'}
                size='sm'
                className='font-normal'>
                {entry.status === 'reversed' ? 'Reversed' : 'Posted'}
              </Badge>
            </span>
            <span className='font-normal text-[11px] text-muted-foreground'>
              {entry.postedAt
                ? formatAuditTimestamp(entry.postedAt, bookTimeZone)
                : entry.docNumber}
            </span>
          </Button>
        ))}
      </div>
    </div>
  )
}
