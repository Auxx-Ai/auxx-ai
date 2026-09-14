// apps/web/src/components/accounting/ui/provider-sync/provider-sync-panel.tsx

'use client'

// "Read what my accountant authored in QuickBooks and put it in my books"
// (plans/accounting/tasks/20-two-authors-one-ledger.md §5-§7, §7.4).
//
// 🛑 A BUTTON, AND ONLY A BUTTON. §7.4 is explicit that the button comes before
// the schedule: there is no cron, no worker job, no run-on-mount and no
// auto-run after the agreement check. The first run of this against a real
// company file wants a person watching it, and the drift it collects is the
// accountant's adjusting work, which happens at close rather than on a Tuesday
// (§8.3, the same argument the agreement view made).
//
// 🛑 THE RANGE IS NOT CLAMPED HERE. `from` empty means "everything the sync is
// allowed to see", which starts at the month after `accounting.cutoffPeriod`.
// A `from` below that floor is a REFUSAL from lib naming both dates, and it is
// surfaced verbatim - it is what stops the opening period being read back and
// the entire opening position being doubled. This file must never quietly move
// a date up to the floor to make the button work.
//
// ⚠️ IT IS SLOW, AND IT SAYS SO. Report endpoints do not paginate (§4.8), so
// the sync issues one provider call per calendar month. Eleven months is eleven
// round trips over the app Lambda and can run for minutes. tRPC gives one
// request and one answer, so there is no per-chunk progress to stream - what
// this can honestly show is the work it has taken on (the month count, from the
// same pure `planSyncChunks` the server walks with) and that time is passing.

import { PermissionKey } from '@auxx/lib/permissions/client'
import { planSyncChunks, providerSyncFloor } from '@auxx/lib/postings/client'
import { Button } from '@auxx/ui/components/button'
import { cn } from '@auxx/ui/lib/utils'
import { RefreshCw } from 'lucide-react'
import { useEffect, useMemo, useRef, useState } from 'react'
import { useAccess } from '~/providers/capabilities-provider'
import type { RouterOutputs } from '~/trpc/react'
import { api } from '~/trpc/react'
import {
  UNKNOWN_PROVIDER_LABEL,
  useAccountingProviderStatus,
} from '../../hooks/use-accounting-provider-status'
import { EntryBlockers } from '../ledger/entry-blockers'
import { ProviderSyncRangeControl, type ProviderSyncRangeMode } from './provider-sync-range-control'
import { ProviderSyncReport } from './provider-sync-report'

type SyncOutcome = RouterOutputs['ledger']['syncProviderLedger']

/** What `quickbooks-section.tsx` says about a disconnected org, said the same way. */
const NOT_CONNECTED_COPY =
  'No accounting system is connected, so there is no ledger to read. The books are kept here ' +
  'either way and nothing is blocked by this.'

export interface ProviderSyncPanelProps {
  /** `accounting.cutoffPeriod`, `YYYY-MM`. Empty until setup has one. */
  cutoffPeriod: string
  /** The org's own reporting currency, for the mismatch warning. */
  orgCurrency: string
  /** Today in the BOOK timezone - the default `to`. */
  todayInBooks: string
  className?: string
}

/** `m:ss`, so a run that has been going for four minutes reads as one. */
function elapsedLabel(seconds: number): string {
  return `${Math.floor(seconds / 60)}:${String(seconds % 60).padStart(2, '0')}`
}

/**
 * The inbound sync: a mode, a range, a button, and everything the last press
 * found.
 *
 * The dates are `YYYY-MM-DD` strings because that is what the procedure takes;
 * `ProviderSyncRangeControl` widens them to `Date` for the shared picker and
 * slices them back, so nothing above this line ever holds a `Date`.
 */
export function ProviderSyncPanel({
  cutoffPeriod,
  orgCurrency,
  todayInBooks,
  className,
}: ProviderSyncPanelProps) {
  const provider = useAccountingProviderStatus()
  const { can } = useAccess()
  const utils = api.useUtils()

  // 🛑 `mode` is what decides whether `from` is sent at all, and `from` stays
  // `''` for the whole of `everything` mode. Two modes rather than one blank
  // field because `DateRange` requires both ends and cannot express the empty
  // start that means "the cutover floor" (brief 27 §4.1).
  const [mode, setMode] = useState<ProviderSyncRangeMode>('everything')
  const [from, setFrom] = useState('')
  const [to, setTo] = useState(todayInBooks)

  /**
   * The earliest date this sync may read, or `null` when the org has no usable
   * `accounting.cutoffPeriod` and the floor cannot be placed.
   *
   * ⚠️ Computed in the browser only so the control can NAME it and bound its
   * calendar. The server recomputes it and refuses below it; this is never the
   * enforcement (`range.ts` says why a filter is the wrong shape for it).
   */
  const [outcome, setOutcome] = useState<SyncOutcome | null>(null)
  const [error, setError] = useState<string | null>(null)
  const [elapsed, setElapsed] = useState(0)

  const floor = useMemo(() => {
    if (!cutoffPeriod) return null
    const resolved = providerSyncFloor(cutoffPeriod)
    return resolved.isOk() ? resolved.value : null
  }, [cutoffPeriod])

  /**
   * What actually goes on the wire.
   *
   * 🛑 BOTH ends are derived from the mode, not just the start. `to` is state a
   * range-mode edit can move, and reading it back in `everything` mode would
   * sync to a date the mode's own copy does not mention - it says "to today in
   * the books" and would have meant "to whatever you last dragged the end to".
   */
  const effectiveFrom = mode === 'range' ? from : ''
  const effectiveTo = mode === 'range' ? to : todayInBooks

  /**
   * 🛑 `ledgerControl`, the same rung the procedure asserts and the same one
   * `setLockedThrough` takes. This sync restates prior months - it writes into
   * closed periods and reverses entries that have vanished - so a `ledgerView`
   * reader is shown the range and the last answer, and no button.
   */
  const canSync = can(PermissionKey.ledgerControl)

  /**
   * How many provider calls this press will make, off the SAME pure walker the
   * server uses. Null when the range cannot be planned in the browser (no
   * cutoff yet, a `from` below the floor, a `to` before `from`) - the server is
   * still the authority on all three, so the button stays live and the real
   * refusal comes back with the message that names the dates.
   */
  const chunks = useMemo(() => {
    if (!cutoffPeriod) return null
    const planned = planSyncChunks({
      cutoffPeriod,
      from: effectiveFrom || undefined,
      to: effectiveTo,
    })
    return planned.isOk() ? planned.value : null
  }, [cutoffPeriod, effectiveFrom, effectiveTo])

  const sync = api.ledger.syncProviderLedger.useMutation({
    onSuccess: (result) => {
      setOutcome(result)
      setError(null)
      // The marker every statement page renders moved, and so did the ledger.
      utils.ledgerReports.providerSyncMarker.invalidate()
      utils.ledger.listPostings.invalidate()
      utils.ledger.verifyBalance.invalidate()
    },
    onError: (mutationError) => {
      setError(mutationError.message)
      setOutcome(null)
    },
  })

  // The one honest thing a single-request mutation can show while it walks
  // eleven months: that it is still going, and for how long.
  const isPending = sync.isPending
  const startedAt = useRef(0)
  useEffect(() => {
    if (!isPending) return
    startedAt.current = Date.now()
    setElapsed(0)
    const timer = setInterval(
      () => setElapsed(Math.floor((Date.now() - startedAt.current) / 1000)),
      1000
    )
    return () => clearInterval(timer)
  }, [isPending])

  const providerLabel = provider.providerLabel ?? UNKNOWN_PROVIDER_LABEL
  const monthCount = chunks?.length ?? null

  return (
    <div className={cn('flex flex-col gap-3', className)}>
      <div className='flex flex-wrap items-end justify-between gap-2'>
        <ProviderSyncRangeControl
          mode={mode}
          onModeChange={(next) => {
            setMode(next)
            setOutcome(null)
            // Seeding on the way in, not on mount: `everything` mode never
            // renders a date, so there is nothing to seed until somebody asks
            // for a range. The current month is the narrowing people reach for,
            // clamped up to the floor so the seed is never itself a refusal.
            if (next === 'range' && !from) setFrom(seedRangeStart(floor, todayInBooks))
          }}
          from={from}
          to={to}
          onRangeChange={(range) => {
            setFrom(range.from)
            setTo(range.to)
            setOutcome(null)
          }}
          floor={floor}
          todayInBooks={todayInBooks}
          disabled={isPending || !canSync}
        />

        {canSync && (
          <Button
            variant='outline'
            size='sm'
            disabled={!provider.connected}
            loading={isPending}
            loadingText={
              monthCount === null
                ? `Reading ${providerLabel}...`
                : `Reading ${monthCount} ${monthCount === 1 ? 'month' : 'months'}...`
            }
            onClick={() => sync.mutate({ from: effectiveFrom || undefined, to: effectiveTo })}>
            <RefreshCw />
            {outcome ? 'Sync again' : 'Sync from ' + providerLabel}
          </Button>
        )}
      </div>

      {!canSync && (
        <p className='text-muted-foreground text-xs'>
          Reading the provider's ledger restates prior months, so it needs ledger control - the same
          authority that closes and reopens a period.
        </p>
      )}

      {/*
        The pending line. `loadingText` alone would be a spinner that says
        nothing while eleven separate provider calls go out, which is worse than
        no button at all - so the work is named, and the clock says it is still
        moving.
      */}
      {isPending && (
        <p className='text-muted-foreground text-xs'>
          {monthCount === null
            ? `Reading ${providerLabel} one month at a time.`
            : `Reading ${effectiveFrom || floor || 'the cutover'} to ${effectiveTo} as ${monthCount} separate ${
                monthCount === 1 ? 'request' : 'requests'
              }, one per month - report endpoints cannot be paged, so the month is the only lever.`}{' '}
          Nothing is written until a month has been read whole. {elapsedLabel(elapsed)} elapsed.
        </p>
      )}

      {!provider.connected && !provider.loading && (
        <p className='text-muted-foreground text-xs'>{NOT_CONNECTED_COPY}</p>
      )}

      {/*
        Every refusal from lib is an `AuxxError` and arrives here with its own
        message - the cutover floor naming both dates, a missing cutoff month, a
        provider that answered for a range nobody asked for. The card carries it
        verbatim: paraphrasing throws away the only part that says what to do.
      */}
      {error && <EntryBlockers blockers={[{ status: 'sync_refused', error }]} />}

      {outcome && (
        <ProviderSyncReport
          outcome={outcome}
          orgCurrency={orgCurrency}
          providerLabel={providerLabel}
        />
      )}
    </div>
  )
}

/**
 * Where a freshly-opened range starts: the first of the current month, or the
 * floor when the floor is later than that.
 *
 * ⚠️ Clamped UP deliberately. An org whose cutoff is the current month has a
 * floor in the next one, and seeding below it would open the picker on a range
 * that is itself a refusal.
 */
function seedRangeStart(floor: string | null, todayInBooks: string): string {
  const firstOfMonth = `${todayInBooks.slice(0, 8)}01`
  if (!floor) return firstOfMonth
  return floor > firstOfMonth ? floor : firstOfMonth
}
