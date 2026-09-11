// apps/web/src/components/accounting/ui/provider-sync/provider-sync-report.tsx

'use client'

// What one run of the inbound sync actually did
// (plans/accounting/tasks/20-two-authors-one-ledger.md §7.4).
//
// 🛑 A COUNT IS NOT AN ANSWER. The mutation returns the whole
// `ProviderSyncOutcome` rather than a success boolean precisely because four
// different questions have to be answerable afterwards, and three of them are
// about things that did NOT reach the books:
//
//   1. What came across      - `written`, `alreadyPosted`, `reversed`.
//   2. What was REFUSED      - every message, verbatim. An entry that was
//      refused is an entry the accountant authored and this org does not have,
//      and a silent count of them is worse than useless.
//   3. What is waiting on a PERSON - `deferredToClosedMonths`. §7.2: the sync
//      reopens nothing on its own, ever. It names the months and somebody with
//      `ledgerControl` decides.
//   4. How far it GOT        - `syncedThrough`. Short of the `to` that was
//      asked for means the walk stopped at an unclean chunk and the months
//      after it were never read.
//
// 🛑 Reported INLINE, never as a toast - the same rule the rest of the
// accounting module follows (ground rule 9, `entry-blockers.tsx`). A refusal
// here names a transaction on the accountant's side; a toast would take that
// away three seconds later.

import { Badge } from '@auxx/ui/components/badge'
import { cn } from '@auxx/ui/lib/utils'
import { CircleAlert, Coins, Lock, Scale, TriangleAlert } from 'lucide-react'
import Link from 'next/link'
import type { ReactNode } from 'react'
import { formatMoney } from '~/components/money/ui/settings/format-money'
import type { RouterOutputs } from '~/trpc/react'

export type ProviderSyncOutcome = RouterOutputs['ledger']['syncProviderLedger']
type DeferredEntry = ProviderSyncOutcome['deferredToClosedMonths'][number]

export interface ProviderSyncReportProps {
  outcome: ProviderSyncOutcome
  /** The org's own reporting currency, for the mismatch warning (decision 12). */
  orgCurrency: string
  /** `'QuickBooks Online'`, or whatever is connected. */
  providerLabel: string
  className?: string
}

/** One closed month, with what the sync wanted to do inside it. */
interface DeferredMonth {
  month: string
  writes: number
  reverses: number
}

/** `2026-01` -> `January 2026`. Built off a fixed UTC day so no zone can shift it. */
function monthName(month: string): string {
  const [year, index] = month.split('-')
  if (!year || !index) return month
  const date = new Date(Date.UTC(Number(year), Number(index) - 1, 15))
  return Number.isNaN(date.getTime())
    ? month
    : date.toLocaleDateString(undefined, { month: 'long', year: 'numeric', timeZone: 'UTC' })
}

/** Group the deferrals by the month they are waiting on, oldest first. */
export function groupDeferredMonths(rows: readonly DeferredEntry[]): DeferredMonth[] {
  const byMonth = new Map<string, DeferredMonth>()
  for (const row of rows) {
    const existing = byMonth.get(row.month) ?? { month: row.month, writes: 0, reverses: 0 }
    if (row.action === 'reverse') existing.reverses += 1
    else existing.writes += 1
    byMonth.set(row.month, existing)
  }
  return [...byMonth.values()].sort((a, b) => a.month.localeCompare(b.month))
}

/**
 * The three readings of `syncedThrough`, which are NOT the same fact.
 *
 * 🛑 `null` is not "nothing happened". The marker advances per CLEAN chunk and
 * latches shut on the first unclean one, so `null` means not one chunk of this
 * run came back clean - and the STORED marker is then left exactly where it
 * was, because "this run read nothing new" is not "nothing has ever been read".
 *
 * ⚠️ `null` also covers a clean chunk whose marker WRITE failed, which the
 * outcome does not distinguish. Both readings say the same true thing here -
 * the marker did not move - so neither overstates coverage.
 */
export function readSyncedThrough(
  outcome: ProviderSyncOutcome
): 'complete' | 'short' | 'never_advanced' {
  if (outcome.syncedThrough === null) return 'never_advanced'
  return outcome.syncedThrough < outcome.to ? 'short' : 'complete'
}

/** A bordered block in the section's own vocabulary. `alarm` is only for a fault. */
function ReportCard({
  tone,
  icon,
  title,
  children,
}: {
  tone: 'neutral' | 'warn' | 'alarm'
  icon: ReactNode
  title: string
  children: ReactNode
}) {
  return (
    <div
      className={cn(
        'flex flex-col gap-2 rounded-xl border p-4',
        tone === 'neutral' && 'border-border bg-muted/40',
        tone === 'warn' && 'border-amber-500/40 bg-amber-500/5 text-amber-700 dark:text-amber-400',
        tone === 'alarm' && 'border-destructive/40 bg-destructive/5'
      )}>
      <div className='flex items-center gap-2'>
        <span className={cn('shrink-0', tone === 'alarm' && 'text-destructive')}>{icon}</span>
        <span className='font-medium text-sm'>{title}</span>
      </div>
      {children}
    </div>
  )
}

/**
 * Everything one press of Sync found and did.
 *
 * Order is deliberate: what the run is worth reading as comes FIRST (a walk
 * that stopped early makes every number under it a partial answer), then what
 * came across, then the two lists a person has to act on.
 */
export function ProviderSyncReport({
  outcome,
  orgCurrency,
  providerLabel,
  className,
}: ProviderSyncReportProps) {
  const currency = outcome.currency ?? orgCurrency
  const coverage = readSyncedThrough(outcome)
  const deferredMonths = groupDeferredMonths(outcome.deferredToClosedMonths)
  const unbalanced = outcome.chunks.flatMap((chunk) => chunk.unbalanced)
  const divergent = outcome.chunks
    .flatMap((chunk) => chunk.ourChecks)
    .filter((check) => check.verdict !== 'matches')
  const currencyMismatch = outcome.currency !== null && outcome.currency !== orgCurrency

  return (
    <div className={cn('flex flex-col gap-3', className)}>
      {/*
        ⚠️ THE LOUD ONE, and it goes first. The walk stops advancing the marker
        at the first chunk that did not bring everything across, and it never
        resumes past it - so a run that was asked for eleven months and marked
        three read eight months it cannot vouch for. Every count below is then a
        partial answer, and saying so after them would be saying it too late.
      */}
      {coverage === 'short' && (
        <ReportCard
          tone='alarm'
          icon={<CircleAlert className='size-4' />}
          title={`Only read through ${outcome.syncedThrough} - the walk stopped early`}>
          <p className='text-sm'>
            You asked for {outcome.from} to {outcome.to}, and {providerLabel} has only been read
            through {outcome.syncedThrough}. The month after that came back with something this sync
            could not bring across, and the marker never advances past an unclean month - a later
            clean month cannot vouch for an earlier broken one. Fix what is listed below and run it
            again; everything already brought across stays.
          </p>
        </ReportCard>
      )}

      {coverage === 'never_advanced' && (
        <ReportCard
          tone='alarm'
          icon={<CircleAlert className='size-4' />}
          title='The synced-through marker did not move'>
          <p className='text-sm'>
            Not one month of {outcome.from} to {outcome.to} came back clean, so the marker is left
            exactly where it was rather than claiming this range has been read. Anything that DID
            come across is in the books - this is about what the statements are allowed to say about
            themselves, not about what was written.
          </p>
        </ReportCard>
      )}

      {coverage === 'complete' && (
        <p className='text-muted-foreground text-xs'>
          Read {outcome.from} to {outcome.to} in {outcome.chunks.length}{' '}
          {outcome.chunks.length === 1 ? 'month' : 'months'}. Statements are now synced through{' '}
          {outcome.syncedThrough}.
        </p>
      )}

      {/* ── 1. What came across ─────────────────────────────────────────── */}
      <div className='grid grid-cols-2 gap-2 sm:grid-cols-4'>
        <Figure label='Written' value={outcome.written} hint='Entries your accountant authored' />
        <Figure
          label='Already there'
          value={outcome.alreadyPosted}
          hint='Held from an earlier run'
        />
        <Figure
          label='Reversed'
          value={outcome.reversed}
          hint='Gone from their side, backed out here'
        />
        <Figure
          label='Months read'
          value={outcome.chunks.length}
          hint={`${outcome.from} to ${outcome.to}`}
        />
      </div>

      {/*
        Decision 12: a currency mismatch WARNS, it does not refuse. Brief 19's
        fill path refuses because it WRITES an opening position; this reads, and
        a sync that brought nothing across because the currencies differ is less
        useful than one that brought the entries and says the figures are not
        directly comparable.
      */}
      {currencyMismatch && (
        <ReportCard
          tone='warn'
          icon={<Coins className='size-4' />}
          title={`${providerLabel} reports in ${outcome.currency}, these books are in ${orgCurrency}`}>
          <p className='text-sm text-muted-foreground'>
            Nothing was converted and nothing was refused. The amounts brought across are the
            provider's own figures, so any statement mixing them with {orgCurrency} entries is
            adding two currencies together.
          </p>
        </ReportCard>
      )}

      {/* ── 2. What was refused. Every one of them, verbatim ─────────────── */}
      {outcome.refusals.length > 0 && (
        <ReportCard
          tone='alarm'
          icon={<TriangleAlert className='size-4' />}
          title={`${outcome.refusals.length} ${outcome.refusals.length === 1 ? 'entry was' : 'entries were'} refused and are NOT in your books`}>
          <ul className='flex list-disc flex-col gap-1.5 pl-5 text-sm'>
            {outcome.refusals.map((refusal) => (
              <li key={refusal}>{refusal}</li>
            ))}
          </ul>
        </ReportCard>
      )}

      {/*
        Also "did not come across", and for the one reason that is never
        negotiable: an unbalanced entry in the ledger is worse than a missing
        one, because it silently breaks every statement that ties. Listed
        separately from the refusals because the remedy is on their side.
      */}
      {unbalanced.length > 0 && (
        <ReportCard
          tone='alarm'
          icon={<Scale className='size-4' />}
          title={`${unbalanced.length} ${unbalanced.length === 1 ? 'entry does' : 'entries do'} not balance in ${providerLabel}`}>
          <p className='text-sm text-muted-foreground'>
            Never written. An entry whose debits and credits disagree would break every statement
            that ties, so it is left where it is and named here instead.
          </p>
          <ul className='flex flex-col gap-1 text-sm'>
            {unbalanced.map((entry) => (
              <li key={`${entry.txnType}-${entry.txnId}`} className='flex flex-wrap gap-x-2'>
                <span className='font-medium'>
                  {entry.txnType} {entry.txnId}
                </span>
                <span className='text-muted-foreground'>{entry.txnDate}</span>
                <span className='tabular-nums text-muted-foreground'>
                  {formatMoney(entry.totalDebitMinor, currency)} debit vs{' '}
                  {formatMoney(entry.totalCreditMinor, currency)} credit
                </span>
              </li>
            ))}
          </ul>
        </ReportCard>
      )}

      {/*
        §5.3, verify on read. Our OWN entries, compared against their copy
        before ours is kept. 🛑 REPORTED, never repaired: deciding that their
        edit wins, or that ours does, makes one entry answer to two authors,
        which is exactly what the single-writer rule exists to prevent.
      */}
      {divergent.length > 0 && (
        <ReportCard
          tone='warn'
          icon={<TriangleAlert className='size-4' />}
          title={`${divergent.length} of your own ${divergent.length === 1 ? 'entry no longer matches' : 'entries no longer match'} ${providerLabel}`}>
          <p className='text-sm text-muted-foreground'>
            Nothing was changed on either side. An entry auxx authored has one author forever, so a
            difference here is something to go and look at, not something this sync may settle.
          </p>
          <ul className='flex flex-col gap-1 text-sm'>
            {divergent.map((check) => (
              <li key={check.glPostingId} className='flex flex-wrap items-center gap-x-2'>
                <span className='font-medium'>{check.docNumber}</span>
                <Badge variant='outline' size='xs'>
                  {check.verdict}
                </Badge>
                <span className='text-muted-foreground'>
                  {check.differences.join('; ') || 'not present in their ledger for this range'}
                </span>
              </li>
            ))}
          </ul>
        </ReportCard>
      )}

      {/* ── 3. What is waiting on a person ──────────────────────────────── */}
      {deferredMonths.length > 0 && (
        <ReportCard
          tone='warn'
          icon={<Lock className='size-4' />}
          title={`${outcome.deferredToClosedMonths.length} ${outcome.deferredToClosedMonths.length === 1 ? 'entry is' : 'entries are'} waiting on a closed month`}>
          <p className='text-sm text-muted-foreground'>
            This is the ordinary case, not a fault: December's adjusting entry arriving in February.
            The sync reopens nothing on its own. Somebody holding ledger control has to reopen the
            month and then run this again, which keeps the reopen in the audit log next to a person.
          </p>
          <ul className='flex flex-col gap-1 text-sm'>
            {deferredMonths.map((month) => (
              <li key={month.month} className='flex flex-wrap items-center gap-x-2'>
                <Link
                  href={`/app/accounting/${month.month}`}
                  className='font-medium hover:underline'>
                  {monthName(month.month)}
                </Link>
                <span className='text-muted-foreground'>
                  {month.writes > 0 &&
                    `${month.writes} ${month.writes === 1 ? 'entry' : 'entries'} to write`}
                  {month.writes > 0 && month.reverses > 0 && ', '}
                  {month.reverses > 0 &&
                    `${month.reverses} to reverse (gone from ${providerLabel})`}
                </span>
              </li>
            ))}
          </ul>
        </ReportCard>
      )}
    </div>
  )
}

/** One count, with what it counts. A bare number here is a number nobody can act on. */
function Figure({ label, value, hint }: { label: string; value: number; hint: string }) {
  return (
    <div className='flex flex-col gap-0.5 rounded-lg border border-border bg-muted/40 p-3'>
      <span className='font-medium text-lg tabular-nums'>{value}</span>
      <span className='text-xs'>{label}</span>
      <span className='text-[11px] text-muted-foreground leading-tight'>{hint}</span>
    </div>
  )
}
