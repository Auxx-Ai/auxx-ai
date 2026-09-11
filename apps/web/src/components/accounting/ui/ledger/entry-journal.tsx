import type { PostingDetailLine, ResolvedPostingLine } from '@auxx/lib/postings/client'
import { toRecordId } from '@auxx/lib/resources/client'
import type { ReactNode } from 'react'
import { useResource } from '~/components/resources'
import { RecordBadge } from '~/components/resources/ui/record-badge'
import { formatAccountLabel } from '../account-label'
import type { StatementColumn, StatementRow } from '../reports/statement-table'
import { StatementTable } from '../reports/statement-table'
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
 * 🛑 Rendered through {@link StatementTable}, NOT a `<table>` of its own. This
 * was the last hand-rolled money table in the subsystem - `ui-plan.md`'s own
 * survey named it by line number ("every subtotal footer in the app is
 * hand-rolled (`entry-journal.tsx:100-110`)") - and §4.1's argument applies to
 * it exactly: a statement rendering as shadcn's bare `Table` sits in the same
 * drawer as the framed `TreeRow` lists everything else uses and reads as a
 * different product. The verdict strip below the table was always modelled on
 * this file; `StatementVerdict` is that idea, so it comes back here as a prop
 * rather than as a second `Alert`.
 *
 * 🛑 No number on this table is ever signed. `direction` is the only carrier of
 * sign in the whole postings module and `amount` is always positive, so a
 * signed rendering would be inventing a second, disagreeing convention, and a
 * bookkeeper handed a two-column table of signed numbers is being asked to do
 * the conversion in their head (13-accounting-ui.md §5.2). Neither column
 * declares `signed`, which is what keeps `formatSignedMinor` away from them.
 *
 * ⚠️ The balanced verdict is stated rather than implied. `buildEntry` refuses to
 * return an unbalanced entry, so in practice this always reads "Balanced", but
 * a screen that shows totals and leaves the reader to compare them is asking for
 * the one mental step this section exists to remove.
 */
/**
 * Drops the `secondary` slot onto a SECOND LINE, under the account name.
 *
 * 🛑 Why this shape and not a wider column. A journal line carries an account
 * name AND an identifying memo ("Sales Tax Payable" / "2026-01 - sales tax,
 * Stephens County Tax"), and in a docked drawer the two do not fit on one line.
 * Sharing the line costs one of them: `TREE_SECONDARY_NOTRUNCATE` makes the
 * secondary `shrink-0` while the title is `truncate`, so the account name gives
 * up ALL of its width first and renders as `S...`. Capping the memo instead
 * just moved the loss onto the memo, whose distinguishing part is its tail.
 * Two lines is the only arrangement where neither is sacrificed - which is what
 * the hand-rolled table this replaced was doing with a `<p>` under the account.
 *
 * The indent is `LeadingIcon`'s `size-7` plus the title's `px-1` (2rem), plus
 * `--statement-label-indent` - the reserved code track and its gap, which
 * `StatementTable` measures over the whole statement and publishes for exactly
 * this. Without that second term the memo lines up under the CODE, so on a row
 * whose account has no code (`Product Revenue`, `Sales Tax Payable`) the name
 * is pushed right past the empty track while the memo stays left, and the two
 * lines disagree. It resolves to `0px` when no row has a code at all, because
 * `AccountLabel` then renders neither the track nor the gap.
 */
const TWO_LINE_ROW = [
  // The title's `py-1.5` is vertical rhythm for a ONE-line row. With the memo
  // directly beneath it, the bottom half of that padding becomes a gap between
  // two halves of the same label, so the pair reads as two rows rather than one.
  '[&>div:first-child>[data-slot=tree-row-title]]:pb-0',
  // The label cluster is a nowrap flex row by default; let it break.
  '[&>div:first-child]:flex-wrap',
  // A whole line of its own, aligned under the title.
  '[&>div:first-child>[data-slot=tree-row-secondary]]:basis-full',
  '[&>div:first-child>[data-slot=tree-row-secondary]]:ms-0',
  '[&>div:first-child>[data-slot=tree-row-secondary]]:ps-[calc(2rem+var(--statement-label-indent,0px))]',
  '[&>div:first-child>[data-slot=tree-row-secondary]]:pb-1',
].join(' ')

const COLUMNS: StatementColumn[] = [
  { key: 'debit', label: 'Debit', align: 'right' },
  { key: 'credit', label: 'Credit', align: 'right' },
]

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

  function counterpartyBadge(line: ResolvedPostingLine): ReactNode {
    if (!line.counterpartyType || !line.counterpartyId) return undefined
    const defId = line.counterpartyType === 'customer' ? contactResource?.id : companyResource?.id
    if (!defId) return undefined
    return <RecordBadge recordId={toRecordId(defId, line.counterpartyId)} size='sm' />
  }

  /**
   * The memo and the counterparty, in `TreeRow`'s VISIBLE `secondary` slot.
   *
   * 🛑 Deliberately NOT `meta.note`, which is the slot lib's own report rows
   * use. `note` renders as `TooltipExplanation` - a `?` you have to hover - and
   * on a journal entry the memo is IDENTIFYING rather than supplementary: a
   * fulfillment entry carries fifteen lines all labelled `Sales Tax Payable`,
   * and the memo ("sales tax, Stephens County Tax") is the only thing that
   * tells them apart. Hidden behind a hover, the table reads as fifteen
   * duplicate rows with different amounts. The old hand-rolled table printed it
   * under the account name for exactly this reason.
   */
  function lineSecondary(line: ResolvedPostingLine): ReactNode {
    const counterparty = counterpartyBadge(line)
    if (!line.memo && !counterparty) return undefined
    return (
      <span className='flex min-w-0 items-center gap-2'>
        {/* No width cap: {@link TWO_LINE_ROW} gives this slot a line of its
            own, so the memo and the account name no longer compete. `truncate`
            still guards the pathological case at the row edge. */}
        {line.memo && <span className='truncate text-muted-foreground text-xs'>{line.memo}</span>}
        {counterparty}
      </span>
    )
  }

  /**
   * One line.
   *
   * `depth` IS the accountant's indent - 0 for a debit, 1 for a credit. A
   * depth-1 row with no children takes `TreeRow`'s padding and nothing else:
   * the connector line is drawn only for a row that actually has children
   * (`BaseTreeRow`), so this borrows the indent without implying a parent.
   */
  function lineRow(line: ResolvedPostingLine, depth: 0 | 1): StatementRow {
    return {
      id: `${line.direction}-${line.glAccountId}-${line.sortOrder}`,
      // The fallback for a line whose `accountName` snapshot is empty;
      // `StatementTable` prefers `meta.accountName` and renders `AccountLabel`.
      label: formatAccountLabel({ code: line.accountCode, name: line.accountName ?? '' }),
      depth,
      kind: 'line',
      values: line.direction === 'debit' ? [line.amount, null] : [null, line.amount],
      meta: {
        glAccountId: line.glAccountId,
        accountCode: line.accountCode,
        accountName: line.accountName,
        badge: lineSecondary(line),
      },
    }
  }

  const rows: StatementRow[] = [
    ...debits.map((line) => lineRow(line, 0)),
    ...credits.map((line) => lineRow(line, 1)),
    {
      id: 'totals',
      label: 'Totals',
      depth: 0,
      kind: 'total',
      values: [totalDebit, totalCredit],
    },
  ]

  return (
    <StatementTable
      columns={COLUMNS}
      rows={rows}
      currency={currencyCode}
      rowClassName={TWO_LINE_ROW}
      verdict={{
        label: balanced
          ? 'Balanced. Debits equal credits.'
          : `Out of balance by ${formatMinor(difference, currencyCode)}.`,
        ok: balanced,
      }}
      // The whole row drills, the idiom every other `StatementTable` consumer
      // uses (`trial-balance.tsx`), replacing the per-row magnifier button. The
      // `glAccountId` guard is what keeps the Totals row inert.
      onRowClick={
        onDrillDown
          ? (row) =>
              row.meta?.glAccountId
                ? onDrillDown({
                    glAccountId: row.meta.glAccountId,
                    accountCode: row.meta.accountCode ?? null,
                    accountName: row.meta.accountName,
                  })
                : undefined
          : undefined
      }
    />
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
