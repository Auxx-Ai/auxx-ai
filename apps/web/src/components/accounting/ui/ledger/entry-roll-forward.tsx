// apps/web/src/components/accounting/ui/ledger/entry-roll-forward.tsx

'use client'

import {
  ACCOUNT_ROLE_LABELS,
  type AccountRole,
  type PostingAssertions,
} from '@auxx/lib/postings/client'
import {
  Table,
  TableBody,
  TableCell,
  TableHead,
  TableHeader,
  TableRow,
} from '@auxx/ui/components/table'
import { EMPTY_CELL, formatMinor, formatSignedMinor } from './format'

/** The three balances a `month_end_inventory` snapshot asserts, in statement order. */
const BALANCE_ROLES = [
  'inventory_raw_materials',
  'inventory_wip',
  'inventory_finished_goods',
] as const satisfies readonly AccountRole[]

/** The activity totals. These have an Activity column and nothing else. */
const ACTIVITY_ROWS = [
  { key: 'absorbedLabor', label: 'Absorbed assembly labor' },
  { key: 'absorbedOverhead', label: 'Absorbed overhead' },
  { key: 'inventoryAdjustments', label: 'Count variance' },
] as const

interface EntryRollForwardProps {
  assertions: PostingAssertions
  currencyCode: string
  /** Account code per role, from the org's own chart. Optional: labels stand alone. */
  accountCodeByRole?: Partial<Record<AccountRole, string>>
}

/**
 * Opening / Activity / Closing, built from the draft's `assertions.before` and
 * `assertions.after`.
 *
 * This is the CPA-legible view and it is not decoration. The journal entry shows
 * the DELTA; the roll-forward shows what the delta is a delta OF, and it is the
 * only thing on screen that makes the `before` = prior row's `after` chain
 * visible to a person (13-accounting-ui.md §5.2).
 *
 * ⚠️ It also catches what the entry cannot. The month-end entry is balanced BY
 * CONSTRUCTION with COGS as the plug, so flipping one lane's direction is
 * absorbed at twice the error and the entry still balances. The roll-forward is
 * where that shows up.
 *
 * The Activity column is a genuine delta, so it carries an explicit sign, the
 * opposite of the journal entry, where `direction` carries the sign and every
 * amount is positive.
 */
export function EntryRollForward({
  assertions,
  currencyCode,
  accountCodeByRole,
}: EntryRollForwardProps) {
  const { before, after } = assertions

  return (
    <div className='flex flex-col gap-3'>
      <Table>
        <TableHeader>
          <TableRow>
            <TableHead className='w-[40%]'>Balance</TableHead>
            <TableHead className='w-40 text-right'>Opening</TableHead>
            <TableHead className='w-40 text-right'>Activity</TableHead>
            <TableHead className='w-40 text-right'>Closing</TableHead>
          </TableRow>
        </TableHeader>
        <TableBody>
          {BALANCE_ROLES.map((role) => {
            const opening = before.balances[role]
            const closing = after.balances[role]
            const code = accountCodeByRole?.[role]
            return (
              <TableRow key={role}>
                <TableCell>
                  <div className='flex items-center gap-2'>
                    {code && (
                      <span className='font-mono text-xs text-muted-foreground'>{code}</span>
                    )}
                    <span>{ACCOUNT_ROLE_LABELS[role]}</span>
                  </div>
                </TableCell>
                <TableCell className='text-right font-mono tabular-nums'>
                  {formatMinor(opening, currencyCode)}
                </TableCell>
                <TableCell className='text-right font-mono tabular-nums'>
                  {formatSignedMinor(closing - opening, currencyCode)}
                </TableCell>
                <TableCell className='text-right font-mono tabular-nums'>
                  {formatMinor(closing, currencyCode)}
                </TableCell>
              </TableRow>
            )
          })}

          {ACTIVITY_ROWS.map((row) => (
            <TableRow key={row.key}>
              <TableCell className='text-muted-foreground'>{row.label}</TableCell>
              <TableCell className='text-right text-muted-foreground'>{EMPTY_CELL}</TableCell>
              <TableCell className='text-right font-mono tabular-nums'>
                {formatSignedMinor(
                  after.activityTotals[row.key] - before.activityTotals[row.key],
                  currencyCode
                )}
              </TableCell>
              <TableCell className='text-right text-muted-foreground'>{EMPTY_CELL}</TableCell>
            </TableRow>
          ))}
        </TableBody>
      </Table>

      <p className='text-xs text-muted-foreground'>
        Opening is what the previous month&apos;s entry asserted as its closing position. The
        activity totals are cumulative to the period end, so their Activity column is the difference
        between the two assertions, not a balance of its own.
      </p>
    </div>
  )
}
