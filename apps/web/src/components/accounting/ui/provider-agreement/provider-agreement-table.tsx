// apps/web/src/components/accounting/ui/provider-agreement/provider-agreement-table.tsx

'use client'

// The reconciliation view's table: our balance, their balance and the
// difference, account by account, as of one date
// (plans/accounting/tasks/20-two-authors-one-ledger.md §8.3).
//
// 🛑 ONE table, two doors. The close console renders it on the period already on
// screen and Accounting > Settings renders it for a date somebody picked, and
// both go through this component - the same rule `OpeningFillButton` follows for
// the same reason (brief 19 §4.7): a comparison that looked different depending
// on where you asked it from would be read as two different answers.
//
// 🛑 This renders a COMPARISON and never becomes a statement source. Every
// report in `reports/` reads our own rows and only our own rows (§0.7), and
// nothing here changes that. What closes the gap is the sync WRITING rows
// (§5 to §7), not a statement learning to read a provider.

import type { ProviderAgreement, ProviderAgreementStatus } from '@auxx/lib/postings/client'
import type { BadgeProps } from '@auxx/ui/components/badge'
import { Badge } from '@auxx/ui/components/badge'
import { EmptySection } from '@auxx/ui/components/section'
import { BookX, TriangleAlert } from 'lucide-react'
import { formatMinor } from '../ledger/format'
import type { StatementColumn, StatementRow } from '../reports/statement-table'
import { StatementTable } from '../reports/statement-table'

/**
 * Three columns, debit-positive throughout.
 *
 * 🛑 Debit-positive on BOTH sides - `ProviderAgreementRow` is built that way
 * (its own header explains why) and this table only renders what it is given.
 * The moment one column were natural-sign, every liability, equity and revenue
 * row would read as disagreeing with itself.
 */
const AGREEMENT_COLUMNS: StatementColumn[] = [
  { key: 'ours', label: 'auxx.ai', align: 'right' },
  { key: 'theirs', label: 'QuickBooks', align: 'right' },
  { key: 'difference', label: 'Difference', align: 'right', signed: true },
]

/**
 * How each status reads, and the order the rows come in.
 *
 * 🛑 `only_theirs` is FIRST and it is the loudest, because it is the whole
 * reason brief 20 exists: an account the provider carries a balance on that our
 * ledger has never posted to is work authored somewhere we do not look. A screen
 * that sorted these by account code would bury the one row type nothing else in
 * the product can tell you about.
 */
const STATUS_META: Record<
  ProviderAgreementStatus,
  { rank: number; label: string; variant: BadgeProps['variant']; note?: string }
> = {
  only_theirs: {
    rank: 0,
    label: 'Only in QuickBooks',
    variant: 'amber',
    note: 'No account in this chart is mapped to it, so this ledger has never carried its balance.',
  },
  differs: { rank: 1, label: 'Differs', variant: 'red' },
  only_ours: {
    // ⚠️ NOT "QuickBooks has no balance on it". A mapped account missing from
    // their report is a `differs` against zero - the report carries non-zero
    // rows only. `only_ours` means UNMAPPED, so the whole of our balance shows
    // in the difference column because there is nothing to net it against.
    rank: 2,
    label: 'Not mapped',
    variant: 'blue',
    note: 'Not linked to any QuickBooks account, so there is nothing to compare it against.',
  },
  match: { rank: 3, label: 'Agrees', variant: 'outline' },
}

/** A row with no name on either side still has to be identifiable in the table. */
function rowLabel(name: string, providerAccountId: string | null): string {
  return name.trim() || providerAccountId || 'Unnamed account'
}

/** `only_theirs` first, then the other differences, then the accounts that agree. */
function toAgreementRows(agreement: ProviderAgreement): StatementRow[] {
  return [...agreement.rows]
    .sort((a, b) => {
      const byStatus = STATUS_META[a.status].rank - STATUS_META[b.status].rank
      if (byStatus !== 0) return byStatus
      // Within a status, the biggest difference first - a reconciliation is read
      // from the top, and an account code sort would put the pennies above the
      // thousands.
      const bySize = Math.abs(b.differenceMinor) - Math.abs(a.differenceMinor)
      if (bySize !== 0) return bySize
      return a.accountName.localeCompare(b.accountName)
    })
    .map((row, index) => {
      const meta = STATUS_META[row.status]
      const name = rowLabel(row.accountName, row.providerAccountId)
      return {
        // ⚠️ The INDEX is in the key deliberately. A provider `account` row with
        // no id is carried through with both ids null (the planner's last loop),
        // and a company file with two of them would otherwise produce two rows
        // keyed `only_theirs::`.
        id: `${row.status}:${row.glAccountId ?? ''}:${row.providerAccountId ?? ''}:${index}`,
        // Never read while `meta.accountName` is set, which it always is here.
        // Present because `StatementRow` requires it.
        label: name,
        depth: 0 as const,
        kind: 'line' as const,
        values: [row.oursMinor, row.theirsMinor, row.differenceMinor],
        meta: {
          // 🛑 The account is rendered by `AccountLabel` through these two
          // fields. Never compose `${code} ${name}` here - the code track, the
          // truncation and the hover title are decisions that file makes once.
          ...(row.glAccountId ? { glAccountId: row.glAccountId } : {}),
          accountCode: row.accountCode,
          accountName: name,
          badge: (
            <Badge variant={meta.variant} size='xs'>
              {meta.label}
            </Badge>
          ),
          ...(meta.note ? { note: meta.note } : {}),
        },
      }
    })
}

export interface ProviderAgreementTableProps {
  agreement: ProviderAgreement
  /** The ORG's ledger currency - what both columns are rendered in. */
  currency: string
  /** The provider's own reporting currency, so a mismatch can be said out loud. */
  providerCurrency: string
  /** 'QuickBooks Online', for the copy. */
  providerLabel: string
}

/**
 * The agreement, as of one date.
 *
 * 🛑 Three answers that must never be flattened into each other, and this
 * component owns two of them (the third, "nothing is connected", is the panel's
 * - it is the only one that can be known without asking):
 *
 *   1. `providerHasData: false` - connected, and the provider answered with an
 *      empty company. Rendering that as "everything agrees" would report a
 *      clean close over a company file nobody has posted to.
 *   2. `totalDifferenceMinor === 0` - the books AGREE, said in as many words.
 *   3. anything else - the rows, `only_theirs` first.
 */
export function ProviderAgreementTable({
  agreement,
  currency,
  providerCurrency,
  providerLabel,
}: ProviderAgreementTableProps) {
  if (!agreement.providerHasData) {
    return (
      <EmptySection
        icon={<BookX className='size-5' />}
        title={`${providerLabel} has no balances as of ${agreement.asOf}`}
        description={
          'The connection worked and the company file reported nothing to compare against. That ' +
          'is not agreement - it is an empty set of books on their side.'
        }
      />
    )
  }

  const rows = toAgreementRows(agreement)
  const differing = agreement.rows.filter((row) => row.differenceMinor !== 0)
  const onlyTheirs = agreement.rows.filter((row) => row.status === 'only_theirs')

  return (
    <div className='flex flex-col gap-3'>
      {/*
        The finding card, on `DuplicateMovementsCard`'s pattern and for the same
        reason: this is a finding on a ledger surface, not a transient notice. It
        names the accounts rather than counting them - "3 accounts" sends
        somebody hunting through the table below for which three.
      */}
      {onlyTheirs.length > 0 && (
        <div className='flex flex-col gap-2 rounded-xl border border-amber-500/40 bg-amber-500/5 p-4'>
          <div className='flex items-start gap-2'>
            <TriangleAlert className='mt-0.5 size-4 shrink-0 text-amber-600' />
            <div className='flex min-w-0 flex-col gap-1'>
              <span className='font-medium'>
                {onlyTheirs.length === 1
                  ? 'One account carries a balance only in QuickBooks'
                  : `${onlyTheirs.length} accounts carry a balance only in QuickBooks`}
              </span>
              <p className='text-muted-foreground text-sm'>
                {onlyTheirs
                  .map((row) => rowLabel(row.accountName, row.providerAccountId))
                  .join(', ')}
                . No account in this chart is mapped to {onlyTheirs.length === 1 ? 'it' : 'them'},
                so whatever put the balance there was authored in {providerLabel} and this ledger
                has never seen it. Either the account is simply unmapped, or the work behind it has
                no counterpart here. Nothing was changed.
              </p>
            </div>
          </div>
        </div>
      )}

      {providerCurrency !== currency && (
        <p className='text-destructive text-sm'>
          {providerLabel} reports in {providerCurrency} and this ledger is kept in {currency}. The
          two columns below are not comparable and nothing here converts them.
        </p>
      )}

      <StatementTable
        columns={AGREEMENT_COLUMNS}
        rows={rows}
        currency={currency}
        searchable
        labelHeading='Account'
        verdict={
          agreement.hasDifferences
            ? {
                ok: false,
                // The SUM OF ABSOLUTE differences, which is what
                // `totalDifferenceMinor` is - never the difference of the two
                // column totals. Two accounts off by equal and opposite amounts
                // net to zero on the second and are not a clean set of books.
                label: `${formatMinor(agreement.totalDifferenceMinor, currency)} apart.`,
                detail:
                  differing.length === 1
                    ? 'One account does not line up as of this date.'
                    : `${differing.length} accounts do not line up as of this date.`,
              }
            : {
                ok: true,
                label: 'The books agree.',
                detail: `Every account either side carries is on the other, at the same figure, as of ${agreement.asOf}.`,
              }
        }
      />
    </div>
  )
}
