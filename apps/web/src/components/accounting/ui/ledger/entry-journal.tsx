// apps/web/src/components/accounting/ui/ledger/entry-journal.tsx

'use client'

import type { ResolvedPostingLine } from '@auxx/lib/postings/client'
import { Button } from '@auxx/ui/components/button'
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
import { CheckCircle2, Search, TriangleAlert } from 'lucide-react'
import { Tooltip } from '~/components/global/tooltip'
import { formatMinor } from './format'

interface EntryJournalProps {
  lines: ResolvedPostingLine[]
  currencyCode: string
  /** Opens the "what is behind this number" report for an account code. */
  onDrillDown?: (accountCode: string, accountName?: string) => void
}

/**
 * The journal entry, in the accountant's indented layout: debits first and
 * flush left, credits indented beneath them, a totals row, and an explicit
 * balanced verdict.
 *
 * 🛑 No number on this table is ever signed. `direction` is the only carrier of
 * sign in the whole postings module and `amount` is always positive, so a
 * signed rendering would be inventing a second, disagreeing convention, and a
 * bookkeeper handed a two-column table of signed numbers is being asked to do
 * the conversion in their head (13-accounting-ui.md §5.2).
 *
 * ⚠️ The balanced verdict is stated rather than implied. `buildEntry` refuses to
 * return an unbalanced entry, so in practice this always reads "Balanced", but
 * a screen that shows totals and leaves the reader to compare them is asking for
 * the one mental step this section exists to remove.
 */
export function EntryJournal({ lines, currencyCode, onDrillDown }: EntryJournalProps) {
  const debits = lines
    .filter((line) => line.direction === 'debit')
    .sort((a, b) => a.sortOrder - b.sortOrder)
  const credits = lines
    .filter((line) => line.direction === 'credit')
    .sort((a, b) => a.sortOrder - b.sortOrder)

  const totalDebit = debits.reduce((sum, line) => sum + line.amount, 0)
  const totalCredit = credits.reduce((sum, line) => sum + line.amount, 0)
  const balanced = totalDebit === totalCredit
  const difference = Math.abs(totalDebit - totalCredit)

  return (
    <div className='flex flex-col gap-3'>
      <Table>
        <TableHeader>
          <TableRow>
            <TableHead className='w-[45%]'>Account</TableHead>
            <TableHead>Memo</TableHead>
            <TableHead className='w-32 text-right'>Debit</TableHead>
            <TableHead className='w-32 text-right'>Credit</TableHead>
          </TableRow>
        </TableHeader>
        <TableBody>
          {[...debits, ...credits].map((line) => (
            <TableRow key={`${line.direction}-${line.accountCode}-${line.sortOrder}`}>
              <TableCell className={cn('align-top', line.direction === 'credit' && 'ps-8')}>
                <div className='flex items-center gap-2'>
                  <span className='font-mono text-xs text-muted-foreground'>
                    {line.accountCode}
                  </span>
                  <span>{line.accountName ?? line.accountCode}</span>
                  {onDrillDown && (
                    <Tooltip content='What is behind this number'>
                      <Button
                        variant='ghost'
                        size='icon-xs'
                        aria-label={`What is behind account ${line.accountCode}`}
                        onClick={() => onDrillDown(line.accountCode, line.accountName)}>
                        <Search />
                      </Button>
                    </Tooltip>
                  )}
                </div>
              </TableCell>
              <TableCell className='align-top text-muted-foreground'>{line.memo}</TableCell>
              <TableCell className='text-right font-mono tabular-nums align-top'>
                {line.direction === 'debit' ? formatMinor(line.amount, currencyCode) : null}
              </TableCell>
              <TableCell className='text-right font-mono tabular-nums align-top'>
                {line.direction === 'credit' ? formatMinor(line.amount, currencyCode) : null}
              </TableCell>
            </TableRow>
          ))}
        </TableBody>
        <TableFooter>
          <TableRow>
            <TableCell colSpan={2}>Totals</TableCell>
            <TableCell className='text-right font-mono tabular-nums'>
              {formatMinor(totalDebit, currencyCode)}
            </TableCell>
            <TableCell className='text-right font-mono tabular-nums'>
              {formatMinor(totalCredit, currencyCode)}
            </TableCell>
          </TableRow>
        </TableFooter>
      </Table>

      <div
        className={cn(
          'flex items-center gap-2 rounded-lg border px-3 py-2 text-sm',
          balanced
            ? 'border-green-500/40 text-green-700 dark:text-green-400'
            : 'border-destructive/50 text-destructive'
        )}>
        {balanced ? <CheckCircle2 className='size-4' /> : <TriangleAlert className='size-4' />}
        <span>
          {balanced
            ? 'Balanced. Debits equal credits.'
            : `Out of balance by ${formatMinor(difference, currencyCode)}.`}
        </span>
      </div>
    </div>
  )
}
