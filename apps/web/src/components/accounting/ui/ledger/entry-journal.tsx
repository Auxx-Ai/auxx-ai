// apps/web/src/components/accounting/ui/ledger/entry-journal.tsx

'use client'

import type { PostingDetailLine, ResolvedPostingLine } from '@auxx/lib/postings/client'
import { toRecordId } from '@auxx/lib/resources/client'
import { Alert } from '@auxx/ui/components/alert'
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
import { useResource } from '~/components/resources'
import { RecordBadge } from '~/components/resources/ui/record-badge'
import { AccountLabel, formatAccountLabel } from '../account-label'
import { formatMinor } from './format'

interface EntryJournalProps {
  lines: ResolvedPostingLine[]
  currencyCode: string
  /** Opens the "what is behind this number" report for an account code. */
  onDrillDown?: (target: {
    glAccountId: string
    accountCode: string | null
    accountName?: string
  }) => void
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
  // Resolved once for the whole table: brief 13 §1's counterparty is either a
  // `contact` (customer) or a `company` (vendor) instance, and the def id is
  // what turns the stored plain id into a `RecordId` `RecordBadge` can render.
  const { resource: contactResource } = useResource('contact')
  const { resource: companyResource } = useResource('company')

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
            <TableHead>Account</TableHead>
            <TableHead className='w-32 text-right'>Debit</TableHead>
            <TableHead className='w-32 text-right'>Credit</TableHead>
          </TableRow>
        </TableHeader>
        <TableBody>
          {[...debits, ...credits].map((line) => (
            <TableRow key={`${line.direction}-${line.glAccountId}-${line.sortOrder}`}>
              <TableCell className={cn('align-top', line.direction === 'credit' && 'ps-8')}>
                <div className='flex items-center gap-2'>
                  <AccountLabel
                    account={{ code: line.accountCode, name: line.accountName ?? '' }}
                  />
                  {onDrillDown && (
                    <Tooltip content='What is behind this number'>
                      <Button
                        variant='ghost'
                        size='icon-xs'
                        aria-label={`What is behind account ${formatAccountLabel({ code: line.accountCode, name: line.accountName ?? '' })}`}
                        onClick={() =>
                          onDrillDown({
                            glAccountId: line.glAccountId,
                            accountCode: line.accountCode,
                            accountName: line.accountName,
                          })
                        }>
                        <Search />
                      </Button>
                    </Tooltip>
                  )}
                </div>
                {line.memo && <p className='mt-0.5 text-muted-foreground text-xs'>{line.memo}</p>}
                {line.counterpartyType &&
                  line.counterpartyId &&
                  (() => {
                    const defId =
                      line.counterpartyType === 'customer'
                        ? contactResource?.id
                        : companyResource?.id
                    if (!defId) return null
                    return (
                      <div className='mt-0.5'>
                        <RecordBadge recordId={toRecordId(defId, line.counterpartyId)} size='sm' />
                      </div>
                    )
                  })()}
              </TableCell>
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
            <TableCell>Totals</TableCell>
            <TableCell className='text-right font-mono tabular-nums'>
              {formatMinor(totalDebit, currencyCode)}
            </TableCell>
            <TableCell className='text-right font-mono tabular-nums'>
              {formatMinor(totalCredit, currencyCode)}
            </TableCell>
          </TableRow>
        </TableFooter>
      </Table>

      <Alert variant={balanced ? 'success' : 'destructive'}>
        {balanced ? <CheckCircle2 /> : <TriangleAlert />}
        <span>
          {balanced
            ? 'Balanced. Debits equal credits.'
            : `Out of balance by ${formatMinor(difference, currencyCode)}.`}
        </span>
      </Alert>
    </div>
  )
}

/**
 * A STORED posting's lines, in the shape this table renders.
 *
 * 🛑 The mapping is deliberately lossless in the direction that matters:
 * `accountName` is the snapshot taken at posting time and is passed straight
 * through, never re-read from the live chart. Renaming or renumbering an account
 * must not restate an entry that has already been posted - decision `P2` is why
 * a posting line names an account by code with no foreign key in the first
 * place.
 *
 * `lineNumber` becomes `sortOrder` because it IS the stored order: the table
 * sorts debits and credits independently, so the two have to agree.
 */
export function journalLinesFromDetail(lines: PostingDetailLine[]): ResolvedPostingLine[] {
  return lines.map((line) => ({
    glAccountId: line.glAccountId,
    accountCode: line.accountCode,
    accountName: line.accountName ?? undefined,
    direction: line.direction,
    amount: line.amountMinor,
    memo: line.memo ?? undefined,
    sourceType: line.sourceType,
    sourceId: line.sourceId,
    sortOrder: line.lineNumber,
    counterpartyType: line.counterpartyType ?? undefined,
    counterpartyId: line.counterpartyId ?? undefined,
  }))
}
