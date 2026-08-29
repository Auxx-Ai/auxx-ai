// apps/web/src/components/accounting/ui/ledger/late-arrivals-section.tsx

'use client'

import { Badge } from '@auxx/ui/components/badge'
import { EmptySection } from '@auxx/ui/components/section'
import {
  Table,
  TableBody,
  TableCell,
  TableHead,
  TableHeader,
  TableRow,
} from '@auxx/ui/components/table'
import { Clock3 } from 'lucide-react'
import { formatAccountingDate, formatAuditTimestamp, formatSignedMinor } from './format'

/** One row dated before the period but entered after the prior close. */
export interface LateArrivalRow {
  id: string
  kind: 'build' | 'adjustment' | 'receipt'
  reference: string
  description: string
  /** The ACCOUNTING date - what decides which period it belongs to. */
  occurredAt: string
  /** When auxx LEARNED about it. Audit evidence, never an accounting date. */
  createdAt: string
  amountMinor: number
}

const KIND_LABEL: Record<LateArrivalRow['kind'], string> = {
  build: 'Build',
  adjustment: 'Adjustment',
  receipt: 'Receipt',
}

interface LateArrivalsSectionProps {
  /**
   * `undefined` means NOBODY ASKED - the read does not exist yet. An empty array
   * means nothing genuinely arrived late, which is a different claim.
   */
  arrivals?: LateArrivalRow[]
  currencyCode: string
  bookTimeZone: string
  /** The month being closed, for the explanatory sentence. */
  periodLabel: string
}

/**
 * Activity dated before this period but entered after the prior close.
 *
 * 🛑 The section that keeps the number explainable. The month-end entry's legs
 * are CUMULATIVE DELTAS, so a build or an adjustment dated in a closed month but
 * entered after that close lands in the next OPEN month's delta. This month's
 * entry can therefore legitimately contain last month's activity, and with
 * nothing on screen saying so, the first instinct is "the entry is wrong"
 * (13-accounting-ui.md §5.2).
 *
 * ⚠️ Both dates are shown because they answer different questions and they can
 * disagree by weeks. `occurredAt` is the ACCOUNTING date, which decides which
 * period a row belongs to. `createdAt` is when auxx LEARNED about the row: audit
 * evidence, never an accounting date.
 *
 * ⚠️ WAITING ON A READ THAT DOES NOT EXIST. The rows are computable from data we
 * hold - movements and builds whose accounting date precedes the period but
 * whose `createdAt` falls after the prior close - but no lib function produces
 * them and 14-drive-the-close.md section 7 leaves the read unspecified. So this
 * renders NOTHING at all when it is handed no data. "Nothing arrived late" is a
 * strong statement about why the entry's number is what it is, and it must not
 * be made by a component that was never given anything to check.
 */
export function LateArrivalsSection({
  arrivals,
  currencyCode,
  bookTimeZone,
  periodLabel,
}: LateArrivalsSectionProps) {
  if (!arrivals) return null

  if (arrivals.length === 0) {
    return (
      <EmptySection
        icon={<Clock3 className='size-5' />}
        title='Nothing arrived late'
        description={`Every row in ${periodLabel}'s entry was both dated in and entered during the period.`}
      />
    )
  }

  const netMinor = arrivals.reduce((sum, row) => sum + row.amountMinor, 0)

  return (
    <div className='flex flex-col gap-3'>
      <p className='text-sm text-muted-foreground'>
        These rows are dated before {periodLabel} but were entered after the previous month had
        already closed. The entry&apos;s legs are cumulative deltas, so they land here rather than
        reopening a closed month. That is why {periodLabel}&apos;s entry carries{' '}
        {formatSignedMinor(netMinor, currencyCode)} of earlier activity.
      </p>

      <Table>
        <TableHeader>
          <TableRow>
            <TableHead className='w-28'>Kind</TableHead>
            <TableHead className='w-32'>Reference</TableHead>
            <TableHead>Description</TableHead>
            <TableHead className='w-36'>Accounting date</TableHead>
            <TableHead className='w-44'>Entered</TableHead>
            <TableHead className='w-32 text-right'>Amount</TableHead>
          </TableRow>
        </TableHeader>
        <TableBody>
          {arrivals.map((row) => (
            <TableRow key={row.id}>
              <TableCell>
                <Badge variant='outline' size='sm'>
                  {KIND_LABEL[row.kind]}
                </Badge>
              </TableCell>
              <TableCell className='font-mono text-xs'>{row.reference}</TableCell>
              <TableCell className='text-muted-foreground'>{row.description}</TableCell>
              <TableCell>{formatAccountingDate(row.occurredAt, bookTimeZone)}</TableCell>
              <TableCell className='text-muted-foreground'>
                {formatAuditTimestamp(row.createdAt, bookTimeZone)}
              </TableCell>
              <TableCell className='text-right font-mono tabular-nums'>
                {formatSignedMinor(row.amountMinor, currencyCode)}
              </TableCell>
            </TableRow>
          ))}
        </TableBody>
      </Table>
    </div>
  )
}
