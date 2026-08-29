// apps/web/src/components/accounting/ui/ledger/count-evidence-section.tsx

'use client'

import { EmptySection } from '@auxx/ui/components/section'
import {
  Table,
  TableBody,
  TableCell,
  TableFooter,
  TableHead,
  TableHeader,
  TableRow,
} from '@auxx/ui/components/table'
import { cn } from '@auxx/ui/lib/utils'
import { ClipboardCheck } from 'lucide-react'
import type { FixtureCountAdjustment } from '~/components/accounting/fixtures'
import {
  formatAccountingDate,
  formatMinor,
  formatSignedMinor,
  formatSignedQuantity,
} from './format'

interface CountEvidenceSectionProps {
  adjustments: FixtureCountAdjustment[]
  currencyCode: string
  bookTimeZone: string
}

/**
 * Cycle-count evidence for the period.
 *
 * 🛑 EVIDENCE, not a passing check, and the distinction is the whole reason this
 * section exists. Under the L1 regime the GL inventory balance is SET FROM the
 * subledger by the month-end entry, so a "does the GL agree with the subledger"
 * tie-out is tautological: it can only ever agree, and a green check that cannot
 * fail trains people to stop reading checks.
 *
 * The physical count is the real error detector: it is the only row on this
 * whole screen that can disagree with itself (13-accounting-ui.md §0.1).
 */
export function CountEvidenceSection({
  adjustments,
  currencyCode,
  bookTimeZone,
}: CountEvidenceSectionProps) {
  if (adjustments.length === 0) {
    return (
      <EmptySection
        icon={<ClipboardCheck className='size-5' />}
        title='No counts were recorded this period'
        description='With no count there is no independent evidence for the closing inventory balance. That is not the same as the balance being right.'
      />
    )
  }

  const netMinor = adjustments.reduce((sum, row) => sum + row.extendedCostMinor, 0)

  return (
    <div className='flex flex-col gap-3'>
      <p className='text-sm text-muted-foreground'>
        Every count adjustment in the period, with the system quantity, what was actually counted,
        and the frozen standard cost the difference was valued at. Read this as evidence about the
        closing balance, not as a check that passed.
      </p>

      <Table>
        <TableHeader>
          <TableRow>
            <TableHead>Part</TableHead>
            <TableHead className='w-20 text-right'>System</TableHead>
            <TableHead className='w-20 text-right'>Counted</TableHead>
            <TableHead className='w-20 text-right'>Delta</TableHead>
            <TableHead className='w-28 text-right'>Unit cost</TableHead>
            <TableHead className='w-32 text-right'>Extended</TableHead>
            <TableHead>Reason</TableHead>
            <TableHead>Counted by</TableHead>
            <TableHead className='w-28'>Date</TableHead>
          </TableRow>
        </TableHeader>
        <TableBody>
          {adjustments.map((row) => (
            <TableRow key={row.movementId}>
              <TableCell>
                <div className='flex flex-col'>
                  <span className='font-mono text-xs text-muted-foreground'>{row.partNumber}</span>
                  <span>{row.partName}</span>
                </div>
              </TableCell>
              <TableCell className='text-right font-mono tabular-nums'>
                {row.systemQuantity}
              </TableCell>
              <TableCell className='text-right font-mono tabular-nums'>
                {row.countedQuantity}
              </TableCell>
              <TableCell
                className={cn(
                  'text-right font-mono tabular-nums',
                  row.delta < 0 && 'text-destructive'
                )}>
                {formatSignedQuantity(row.delta)}
              </TableCell>
              <TableCell className='text-right font-mono tabular-nums'>
                {formatMinor(row.unitCostMinor, currencyCode)}
              </TableCell>
              <TableCell className='text-right font-mono tabular-nums'>
                {formatSignedMinor(row.extendedCostMinor, currencyCode)}
              </TableCell>
              <TableCell className='text-muted-foreground'>{row.reason}</TableCell>
              <TableCell className='text-muted-foreground'>{row.actorName}</TableCell>
              <TableCell className='text-muted-foreground'>
                {formatAccountingDate(row.occurredAt, bookTimeZone)}
              </TableCell>
            </TableRow>
          ))}
        </TableBody>
        <TableFooter>
          <TableRow>
            <TableCell colSpan={5}>Net count variance</TableCell>
            <TableCell className='text-right font-mono tabular-nums'>
              {formatSignedMinor(netMinor, currencyCode)}
            </TableCell>
            <TableCell colSpan={3} />
          </TableRow>
        </TableFooter>
      </Table>
    </div>
  )
}
