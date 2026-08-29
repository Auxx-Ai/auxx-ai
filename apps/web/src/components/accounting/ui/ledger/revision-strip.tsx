// apps/web/src/components/accounting/ui/ledger/revision-strip.tsx

'use client'

import { Badge } from '@auxx/ui/components/badge'
import { Button } from '@auxx/ui/components/button'
import { cn } from '@auxx/ui/lib/utils'
import { History } from 'lucide-react'
import type { FixtureRevision } from '~/components/accounting/fixtures'
import { formatAuditTimestamp } from './format'

interface RevisionStripProps {
  revisions: FixtureRevision[]
  activePostingId: string | null
  onSelect: (glPostingId: string) => void
  bookTimeZone: string
}

/**
 * The month's revision chain: revision 0 posted then reversed, revision 1 the
 * reversal, revision 2 the re-entry.
 *
 * 🛑 Renders ONLY when the month has a revision above 0, which is what the
 * caller checks. Under the L1 regime a month has exactly one effective entry, so
 * a permanent list-of-one would be chrome; the chain is the only thing a month
 * genuinely has more than one of (13-accounting-ui.md §5.2).
 *
 * Selecting a revision opens the posting drawer on it. That is what
 * `?posting=<id>` is for: a historical revision, not the primary read path.
 */
export function RevisionStrip({
  revisions,
  activePostingId,
  onSelect,
  bookTimeZone,
}: RevisionStripProps) {
  if (revisions.length === 0) return null

  return (
    <div className='flex flex-col gap-2 rounded-xl border bg-muted/30 p-3'>
      <div className='flex items-center gap-2 text-xs text-muted-foreground'>
        <History className='size-3.5' />
        <span>
          This month was posted {revisions.length} times. The effective entry is the newest
          revision; the earlier ones are kept and reversed, never edited.
        </span>
      </div>
      <div className='flex flex-wrap gap-1.5'>
        {revisions.map((revision) => (
          <Button
            key={revision.glPostingId}
            variant={revision.glPostingId === activePostingId ? 'secondary' : 'outline'}
            size='sm'
            className={cn('h-auto flex-col items-start gap-0.5 py-1.5')}
            onClick={() => onSelect(revision.glPostingId)}>
            <span className='flex items-center gap-1.5'>
              <span>Revision {revision.revision}</span>
              <Badge
                variant={revision.status === 'reversed' ? 'outline' : 'green'}
                size='sm'
                className='font-normal'>
                {revision.status === 'reversed' ? 'Reversed' : 'Posted'}
              </Badge>
            </span>
            <span className='font-normal text-[11px] text-muted-foreground'>
              {formatAuditTimestamp(revision.postedAt, bookTimeZone)}
            </span>
          </Button>
        ))}
      </div>
    </div>
  )
}
