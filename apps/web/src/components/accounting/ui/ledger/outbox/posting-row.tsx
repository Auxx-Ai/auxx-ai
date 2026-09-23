// apps/web/src/components/accounting/ui/ledger/outbox/posting-row.tsx

'use client'

import { Badge } from '@auxx/ui/components/badge'
import { FileClock } from 'lucide-react'
import type { ReactNode } from 'react'
import type { RouterOutputs } from '~/trpc/react'
import { EMPTY_CELL, formatAccountingDate, formatMinor } from '../format'
import { postingTypeLabel } from '../type-labels'
import { OutboxRow } from './outbox-row'
import { BADGE_ROW_CLASS, PostingLinks } from './posting-links'

/** A posting as the export reads it: a batch member, or a bucket's unbuilt member. */
export type OutboxPosting = RouterOutputs['ledger']['exportBatches']['unbuiltMembers'][number]

interface PostingRowProps {
  posting: OutboxPosting
  currencyCode: string
  bookTimeZone: string
  depth?: number
  activePostingId: string | null
  onSelectPosting: (glPostingId: string) => void
  /** Landed in its bucket after the batch was built. */
  isNew?: boolean
  /** Off under a summary row, where the posting is not its own item. */
  selectable?: boolean
  /** Badges and buttons after the amount. */
  actions?: ReactNode
}

/** One posting: date, type, doc number or memo, its records; a click opens the `?posting=` drawer. */
export function PostingRow({
  posting,
  currencyCode,
  bookTimeZone,
  depth,
  activePostingId,
  onSelectPosting,
  isNew = false,
  selectable = false,
  actions,
}: PostingRowProps) {
  return (
    <OutboxRow
      id={posting.glPostingId}
      depth={depth}
      selectable={selectable}
      selectLabel={`${selectable ? 'Select' : 'Open'} ${posting.docNumber ?? postingTypeLabel(posting.postingType)}`}
      icon={<FileClock className='size-4 text-muted-foreground' />}
      date={formatAccountingDate(posting.txnDate, bookTimeZone)}
      typeLabel={postingTypeLabel(posting.postingType)}
      title={posting.docNumber || posting.memo || EMPTY_CELL}
      secondary={
        <span className={BADGE_ROW_CLASS}>
          {isNew && (
            <Badge variant='blue' size='xs'>
              new
            </Badge>
          )}
          <PostingLinks sources={posting.sources} />
        </span>
      }
      amount={formatMinor(posting.totalMinor, currencyCode)}
      actions={actions}
      onOpen={() => onSelectPosting(posting.glPostingId)}
      active={activePostingId === posting.glPostingId}
    />
  )
}
