// apps/web/src/components/accounting/ui/ledger/posted-after-review-section.tsx

'use client'

import { Badge } from '@auxx/ui/components/badge'
import { EmptySection } from '@auxx/ui/components/section'
import { TREE_SECONDARY_NOTRUNCATE, TreeRow } from '@auxx/ui/components/tree-row'
import { TreeRowList } from '@auxx/ui/components/tree-row-list'
import { CalendarCheck2, FileText } from 'lucide-react'
import { useState } from 'react'
import { api, type RouterOutputs } from '~/trpc/react'
import {
  formatAccountingDate,
  formatAuditTimestamp,
  formatMinor,
  formatPeriodLabel,
} from './format'

type ReviewedMonth = RouterOutputs['ledger']['postedAfterReview'][number]

interface PostedAfterReviewSectionProps {
  currencyCode: string
  bookTimeZone: string
  onSelectPosting: (id: string) => void
}

/** Entries dated in a reviewed month but created after its review, one group per month. */
export function PostedAfterReviewSection({
  currencyCode,
  bookTimeZone,
  onSelectPosting,
}: PostedAfterReviewSectionProps) {
  const { data, isPending } = api.ledger.postedAfterReview.useQuery()
  const months = data ?? []
  const [closed, setClosed] = useState<Set<string>>(() => new Set())

  if (!isPending && months.length === 0) {
    return (
      <EmptySection
        icon={<CalendarCheck2 className='size-5' />}
        title='Nothing posted after review'
        description='Entries dated in a reviewed month that post later are listed here.'
      />
    )
  }

  const toggle = (periodKey: string) =>
    setClosed((previous) => {
      const next = new Set(previous)
      if (next.has(periodKey)) next.delete(periodKey)
      else next.add(periodKey)
      return next
    })

  return (
    <TreeRowList
      items={months}
      loading={isPending}
      skeletonCount={2}
      getKey={(month) => month.periodKey}
      renderRow={(month: ReviewedMonth) => (
        <TreeRow
          className={TREE_SECONDARY_NOTRUNCATE}
          icon={<CalendarCheck2 className='size-4' />}
          title={<span className='truncate text-sm'>{formatPeriodLabel(month.periodKey)}</span>}
          secondary={
            <span className='text-xs text-muted-foreground'>
              Reviewed {month.reviewedAtApproximate ? 'on or before ' : ''}
              {formatAuditTimestamp(month.reviewedAt, bookTimeZone)}
            </span>
          }
          actions={
            <span className='px-1 text-xs text-muted-foreground tabular-nums'>
              {month.entries.length}
            </span>
          }
          expandable
          isOpen={!closed.has(month.periodKey)}
          onToggleOpen={() => toggle(month.periodKey)}>
          {month.entries.map((entry) => (
            <TreeRow
              key={entry.id}
              depth={1}
              className={TREE_SECONDARY_NOTRUNCATE}
              icon={<FileText className='size-4' />}
              title={<span className='truncate text-sm'>{entry.memo || entry.docNumber}</span>}
              secondary={
                <span className='flex items-center gap-1.5'>
                  {entry.docNumber && (
                    <Badge variant='outline' size='xs' className='font-mono'>
                      {entry.docNumber}
                    </Badge>
                  )}
                  <span className='text-xs'>
                    {formatAccountingDate(entry.txnDate, bookTimeZone)}
                  </span>
                  <span className='font-mono text-xs tabular-nums'>
                    {formatMinor(entry.totalMinor, currencyCode)}
                  </span>
                  <span className='text-xs text-muted-foreground'>
                    entered {formatAuditTimestamp(entry.createdAt, bookTimeZone)}
                  </span>
                </span>
              }
              onToggleOpen={() => onSelectPosting(entry.id)}
            />
          ))}
        </TreeRow>
      )}
    />
  )
}
