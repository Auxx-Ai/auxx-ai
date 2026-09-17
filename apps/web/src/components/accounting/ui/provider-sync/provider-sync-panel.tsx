// apps/web/src/components/accounting/ui/provider-sync/provider-sync-panel.tsx

'use client'

// "Read what my accountant authored in QuickBooks and put it in my books"
// (plans/accounting/tasks/20-two-authors-one-ledger.md §5-§7, §7.4;
// plans/accounting/tasks/55-the-inbound-sync-runs-in-a-worker.md §2.2, §4.8).
//
// 🛑 A BUTTON THAT ENQUEUES. Still no cron, no run-on-mount and no auto-run
// after the agreement check - what changed is only WHERE the walk happens.
// 20 §8.3 ("cadence: at close, plus on demand, not continuous") is an argument
// against a SCHEDULE, and this file used to collapse it into "no background job"
// as well. Those are separable: nine months is nine sequential app-runtime round
// trips and the transport gives up before the walk does (55 §2), so the press
// hands the walk to a worker and this reads the run back. The press is still the
// only trigger that exists.
//
// 🛑 THE RANGE PICKER IS GONE (MK, 2026-09-17). The sync always runs the cutover
// floor -> today. Re-reading one month by hand was the recovery path for a bad
// month, and 55 §4.2 replaces it with a better one: a `partial-retriable` slice
// holds the cursor and the chain re-reads that month itself. The floor is still
// never clamped here - `from` is simply not sent, and lib places it.
//
// 🔑 THE OUTCOME SURVIVES A REMOUNT. It is read from `providerSync.state`
// through `useProviderSyncRun`, not held in `useState`, which is 55 §2.3.2 fixed
// by construction. The one thing that IS local state is the refusal from the
// press itself - a `ConflictError` from the open-run guard, or a queue that
// would not take the job - because that is a fact about this press rather than
// about any run, and there is no run to read it off.

import { PermissionKey } from '@auxx/lib/permissions/client'
import { Button } from '@auxx/ui/components/button'
import { RefreshCw } from 'lucide-react'
import { useEffect, useState } from 'react'
import { FieldPanelRow } from '~/components/global/forms/field-panel'
import { useAccess } from '~/providers/capabilities-provider'
import { api } from '~/trpc/react'
import {
  UNKNOWN_PROVIDER_LABEL,
  useAccountingProviderStatus,
} from '../../hooks/use-accounting-provider-status'
import { useProviderSyncRun } from '../../hooks/use-provider-sync-run'
import { EntryBlockers } from '../ledger/entry-blockers'
import { describeProviderSyncRun, ProviderSyncReport } from './provider-sync-report'

export interface ProviderSyncNowRowProps {
  /** Today in the BOOK timezone - the `to` every press sends. */
  todayInBooks: string
}

/**
 * The `Sync now` row: the button, and what the last or current run found.
 *
 * `to` is today in the BOOK timezone rather than the browser's - an accounting
 * date is a calendar day in the books' own zone, and defaulting to the viewer's
 * would put a bookkeeper in Auckland a day ahead of their own ledger.
 */
export function ProviderSyncNowRow({ todayInBooks }: ProviderSyncNowRowProps) {
  const provider = useAccountingProviderStatus()
  const { can } = useAccess()
  const utils = api.useUtils()
  const run = useProviderSyncRun()
  const [pressError, setPressError] = useState<string | null>(null)

  /**
   * 🛑 `ledgerControl`, the same rung the procedure asserts and the same one
   * `setLockedThrough` takes. This sync restates prior months - it writes into
   * closed periods and reverses entries that have vanished - so a `ledgerView`
   * reader is shown the last run and no button.
   */
  const canSync = can(PermissionKey.ledgerControl)

  const sync = api.ledger.syncProviderLedger.useMutation({
    onSuccess: () => {
      setPressError(null)
      // The run opens in the worker a moment later; this is what starts the poll.
      utils.ledger.providerSyncRunState.invalidate()
    },
    onError: (error) => setPressError(error.message),
  })

  const isRunning = Boolean(run.currentRun) && !run.stale
  const now = useTicker(isRunning)
  const providerLabel = provider.providerLabel ?? UNKNOWN_PROVIDER_LABEL
  const reading = describeProviderSyncRun(run, providerLabel, now)

  return (
    <FieldPanelRow
      title='Sync now'
      description={`Read ${providerLabel}'s general ledger from the cutover forward and write everything your accountant authored there into these books. Depreciation, accruals, reclasses and payroll - the entries that are never authored here.`}>
      <div className='flex w-full flex-col gap-2'>
        <div className='flex items-center justify-between gap-2'>
          <span className='text-sm'>{reading.headline}</span>
          {canSync && (
            <Button
              variant='outline'
              size='sm'
              disabled={!provider.connected || isRunning}
              loading={sync.isPending || isRunning}
              loadingText={sync.isPending ? 'Starting...' : 'Reading...'}
              onClick={() => sync.mutate({ to: todayInBooks })}>
              <RefreshCw />
              Sync now
            </Button>
          )}
        </div>

        {reading.detail && <p className='text-muted-foreground text-xs'>{reading.detail}</p>}

        {!canSync && (
          <p className='text-muted-foreground text-xs'>
            Reading the provider's ledger restates prior months, so it needs ledger control - the
            same authority that closes and reopens a period.
          </p>
        )}

        {/*
          Every refusal from lib is an `AuxxError` and arrives here with its own
          message - the cutover floor naming both dates, a run already open, a
          queue that would not take the job. The card carries it verbatim:
          paraphrasing throws away the only part that says what to do.
        */}
        {pressError && <EntryBlockers blockers={[{ status: 'sync_refused', error: pressError }]} />}
      </div>
    </FieldPanelRow>
  )
}

/** The detail behind the row above - refusals, unbalanced entries, deferrals. */
export function ProviderSyncRunDetail({ className }: { className?: string }) {
  const provider = useAccountingProviderStatus()
  const run = useProviderSyncRun()
  return (
    <ProviderSyncReport
      currentRun={run.currentRun}
      lastRun={run.lastRun}
      stale={run.stale}
      providerLabel={provider.providerLabel ?? UNKNOWN_PROVIDER_LABEL}
      className={className}
    />
  )
}

/**
 * A once-a-second clock, and only while a walk is open.
 *
 * The one honest thing a poll can add between slices: that time is passing. A
 * run that has been going for four minutes must not look like one that started.
 */
function useTicker(active: boolean): number {
  const [now, setNow] = useState(() => Date.now())
  useEffect(() => {
    if (!active) return
    setNow(Date.now())
    const timer = setInterval(() => setNow(Date.now()), 1000)
    return () => clearInterval(timer)
  }, [active])
  return now
}
