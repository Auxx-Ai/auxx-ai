// apps/web/src/components/accounting/ui/reports/account-lines-dialog.tsx

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
import Link from 'next/link'
import { api } from '~/trpc/react'
import { formatAccountingDate, formatMinor, formatSignedMinor } from '../ledger/format'
import { periodKeyFromDate } from './report-helpers'

export interface AccountLinesDialogTarget {
  accountCode: string
  /** `YYYY-MM-DD`, both optional - an omitted bound reads cumulative-from-the-beginning. */
  from?: string
  to?: string
}

interface AccountLinesDialogProps {
  target: AccountLinesDialogTarget | null
  onOpenChange: (open: boolean) => void
  currencyCode: string
  bookTimeZone: string
}

/**
 * "What is behind this account" for a row click on any statement
 * (`plans/accounting/ui-plan.md` §2.4) - a copy of `ledger/line-drill-down.tsx`'s
 * shape, adapted to read the report's own `ledgerReports.accountLines` rather
 * than the per-line subledger query that dialog is still waiting on (its own
 * header explains why: a month-end posting line has no stored provenance to
 * expand). This one has real data: every POSTED line against the account in
 * the range, oldest first, with a running natural-sign balance. Each row
 * links back to the posting on the ledger page, in the month the line
 * actually landed in.
 */
export function AccountLinesDialog({
  target,
  onOpenChange,
  currencyCode,
  bookTimeZone,
}: AccountLinesDialogProps) {
  const { data, isPending } = api.ledgerReports.accountLines.useQuery(
    { accountCode: target?.accountCode ?? '', from: target?.from, to: target?.to },
    { enabled: !!target }
  )

  return (
    <Dialog open={!!target} onOpenChange={onOpenChange}>
      <DialogContent size='xl'>
        <DialogHeader>
          <DialogTitle>
            {data ? `${data.accountCode} ${data.accountName}`.trim() : target?.accountCode}
          </DialogTitle>
          <DialogDescription>
            Every posted line against this account in the range, oldest first, with a running
            balance.
          </DialogDescription>
        </DialogHeader>

        {isPending || !data ? null : data.lines.length === 0 ? (
          <EmptySection
            icon={<FileSearch className='size-5' />}
            title='Nothing posted to this account'
            description='No posted lines fall in this range.'
          />
        ) : (
          <Table>
            <TableHeader>
              <TableRow>
                <TableHead className='w-32'>Date</TableHead>
                <TableHead className='w-32'>Doc #</TableHead>
                <TableHead>Memo</TableHead>
                <TableHead className='w-24'>Direction</TableHead>
                <TableHead className='w-32 text-right'>Amount</TableHead>
                <TableHead className='w-32 text-right'>Balance</TableHead>
              </TableRow>
            </TableHeader>
            <TableBody>
              {data.lines.map((line, index) => (
                <TableRow key={`${line.glPostingId}-${index}`}>
                  <TableCell>{formatAccountingDate(line.txnDate, bookTimeZone)}</TableCell>
                  <TableCell className='font-mono text-xs'>
                    <Link
                      href={`/app/accounting/${periodKeyFromDate(line.txnDate)}?posting=${line.glPostingId}`}
                      className='hover:underline'>
                      {line.docNumber}
                    </Link>
                  </TableCell>
                  <TableCell className='text-muted-foreground'>{line.memo ?? ''}</TableCell>
                  <TableCell className='capitalize text-muted-foreground'>
                    {line.direction}
                  </TableCell>
                  <TableCell className='text-right font-mono tabular-nums'>
                    {formatMinor(line.amountMinor, currencyCode)}
                  </TableCell>
                  <TableCell className='text-right font-mono tabular-nums'>
                    {formatSignedMinor(line.runningBalanceMinor, currencyCode)}
                  </TableCell>
                </TableRow>
              ))}
            </TableBody>
            <TableFooter>
              <TableRow>
                <TableCell colSpan={5}>Ending balance</TableCell>
                <TableCell className='text-right font-mono tabular-nums'>
                  {formatSignedMinor(data.endingBalanceMinor, currencyCode)}
                </TableCell>
              </TableRow>
            </TableFooter>
          </Table>
        )}
      </DialogContent>
    </Dialog>
  )
}
