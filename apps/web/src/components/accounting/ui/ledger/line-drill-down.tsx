// apps/web/src/components/accounting/ui/ledger/line-drill-down.tsx

'use client'

import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogHeader,
  DialogTitle,
} from '@auxx/ui/components/dialog'
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
import { FileSearch } from 'lucide-react'
import { formatAccountingDate, formatMinor, formatSignedMinor } from './format'

export interface LineDrillDownTarget {
  accountCode: string
  accountName?: string
}

/** One subledger row behind a posting line. */
export interface LineDrillDownRow {
  id: string
  reference: string
  description: string
  occurredAt: string
  quantity: number
  unitCostMinor: number
  extendedCostMinor: number
}

interface LineDrillDownProps {
  target: LineDrillDownTarget | null
  /**
   * The subledger rows for `target`. `undefined` means the read does not exist,
   * and the caller must not offer the affordance that opens this dialog at all.
   */
  rows?: LineDrillDownRow[]
  onOpenChange: (open: boolean) => void
  currencyCode: string
  bookTimeZone: string
  periodLabel: string
}

/**
 * "What is behind this number" for one line of the entry.
 *
 * ⚠️ A REPORT, not an expander, and the difference is not cosmetic. A posting
 * line carries exactly ONE `sourceType` + `sourceId`, and a month-end line is a
 * single row per account role summarising hundreds of movements, so there is
 * no stored provenance to expand. Gap-g's "click 4000 and see the 41 order ids"
 * is not backed by the shipped data; this is a separate query back into the
 * subledger, and presenting it as an inline expander would imply the ledger
 * stores something it does not (13-accounting-ui.md §5.2).
 *
 * ⚠️ WAITING ON A READ THAT DOES NOT EXIST: a subledger query scoped to the
 * account role and the period. Nothing in `packages/lib` produces it and
 * 14-drive-the-close.md section 7 leaves it unspecified. Until it lands the
 * CALLER must not offer the magnifier that opens this dialog - an empty dialog
 * saying "no subledger rows resolved to this account" is a false answer, not a
 * missing one, and it is worse than no button. The component and its shape stay
 * because the report is coming.
 */
export function LineDrillDown({
  target,
  rows,
  onOpenChange,
  currencyCode,
  bookTimeZone,
  periodLabel,
}: LineDrillDownProps) {
  if (!rows) return null

  const total = rows.reduce((sum, row) => sum + row.extendedCostMinor, 0)

  return (
    <Dialog open={!!target} onOpenChange={onOpenChange}>
      <DialogContent size='xl'>
        <DialogHeader>
          <DialogTitle>
            {target?.accountCode} {target?.accountName ?? ''}
          </DialogTitle>
          <DialogDescription>
            The subledger rows behind this line for {periodLabel}. The posting line itself records
            one summarised figure, so this is read back out of the subledger rather than out of the
            entry.
          </DialogDescription>
        </DialogHeader>

        {rows.length === 0 ? (
          <EmptySection
            icon={<FileSearch className='size-5' />}
            title='Nothing to show for this account'
            description='No subledger rows resolved to this account in the period.'
          />
        ) : (
          <Table>
            <TableHeader>
              <TableRow>
                <TableHead className='w-32'>Reference</TableHead>
                <TableHead>Description</TableHead>
                <TableHead className='w-32'>Date</TableHead>
                <TableHead className='w-24 text-right'>Quantity</TableHead>
                <TableHead className='w-32 text-right'>Unit cost</TableHead>
                <TableHead className='w-32 text-right'>Extended</TableHead>
              </TableRow>
            </TableHeader>
            <TableBody>
              {rows.map((row) => (
                <TableRow key={row.id}>
                  <TableCell className='font-mono text-xs'>{row.reference}</TableCell>
                  <TableCell className='text-muted-foreground'>{row.description}</TableCell>
                  <TableCell>{formatAccountingDate(row.occurredAt, bookTimeZone)}</TableCell>
                  <TableCell className='text-right font-mono tabular-nums'>
                    {row.quantity}
                  </TableCell>
                  <TableCell className='text-right font-mono tabular-nums'>
                    {formatMinor(row.unitCostMinor, currencyCode)}
                  </TableCell>
                  <TableCell className='text-right font-mono tabular-nums'>
                    {formatSignedMinor(row.extendedCostMinor, currencyCode)}
                  </TableCell>
                </TableRow>
              ))}
            </TableBody>
            <TableFooter>
              <TableRow>
                <TableCell colSpan={5}>Net movement</TableCell>
                <TableCell className='text-right font-mono tabular-nums'>
                  {formatSignedMinor(total, currencyCode)}
                </TableCell>
              </TableRow>
            </TableFooter>
          </Table>
        )}
      </DialogContent>
    </Dialog>
  )
}
