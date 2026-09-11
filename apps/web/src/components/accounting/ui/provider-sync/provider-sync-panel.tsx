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

import { FieldType } from '@auxx/database/enums'
import { PermissionKey } from '@auxx/lib/permissions/client'
import { planSyncChunks } from '@auxx/lib/postings/client'
import { Button } from '@auxx/ui/components/button'
import { cn } from '@auxx/ui/lib/utils'
import { RefreshCw } from 'lucide-react'
import { useEffect, useMemo, useRef, useState } from 'react'
import { FieldInputAdapter } from '~/components/fields/inputs/field-input-adapter'
import { useAccess } from '~/providers/capabilities-provider'
import type { RouterOutputs } from '~/trpc/react'
import { api } from '~/trpc/react'
import { useAccountingProviderStatus } from '../../hooks/use-accounting-provider-status'
import { EntryBlockers } from '../ledger/entry-blockers'
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
 * The inbound sync: a range, a button, and everything the last press found.
 *
 * The date fields are `YYYY-MM-DD` strings because that is what the procedure
 * takes; they are widened to an instant on the way into `FieldInputAdapter` and
 * sliced back on the way out, the same round trip the agreement panel and the
 * JE drawer do.
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

  // Empty means the floor. Deliberately NOT pre-filled with the floor date: a
  // pre-filled value is a value somebody edits, and the one edit that matters
  // here is the one that must be refused.
  const [from, setFrom] = useState('')
  const [to, setTo] = useState(todayInBooks)
  const [outcome, setOutcome] = useState<SyncOutcome | null>(null)
  const [error, setError] = useState<string | null>(null)
  const [elapsed, setElapsed] = useState(0)

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
    const planned = planSyncChunks({ cutoffPeriod, from: from || undefined, to })
    return planned.isOk() ? planned.value : null
  }, [cutoffPeriod, from, to])

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

  const providerLabel = provider.providerLabel ?? 'QuickBooks'
  const monthCount = chunks?.length ?? null

  return (
    <div className={cn('flex flex-col gap-3', className)}>
      <div className='flex flex-wrap items-end gap-2'>
        <DateField
          label='From'
          value={from}
          placeholderNote='cutover'
          disabled={isPending || !canSync}
          onChange={(next) => {
            setFrom(next)
            setOutcome(null)
          }}
        />
        <DateField
          label='To'
          value={to}
          disabled={isPending || !canSync}
          onChange={(next) => {
            if (!next) return
            setTo(next)
            setOutcome(null)
          }}
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
            onClick={() => sync.mutate({ from: from || undefined, to })}>
            <RefreshCw />
            {outcome ? 'Sync again' : 'Sync from ' + providerLabel}
          </Button>
        )}
      </div>

      {/*
        🛑 What an empty `From` means, said out loud. It is not "no start date":
        it is the cutover floor, the earliest date the sync may ever read, and
        the reason a date below it comes back refused rather than quietly moved.
      */}
      <p className='text-muted-foreground text-xs'>
        Leave <span className='font-medium'>From</span> empty to read everything this sync is
        allowed to see, which starts the month after your accounting cutoff. Anything before that is
        already in the books as the single opening entry, so a date earlier than the cutover is
        refused rather than moved forward.
      </p>

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
            : `Reading ${from || 'the cutover'} to ${to} as ${monthCount} separate ${
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

/** One `YYYY-MM-DD` field. `''` is a real value here - it means "the floor". */
function DateField({
  label,
  value,
  placeholderNote,
  disabled,
  onChange,
}: {
  label: string
  value: string
  placeholderNote?: string
  disabled: boolean
  onChange: (value: string) => void
}) {
  return (
    <div className='flex flex-col gap-1'>
      <span className='text-muted-foreground text-xs'>
        {label}
        {placeholderNote && !value && ` (${placeholderNote})`}
      </span>
      <div className='w-44'>
        <FieldInputAdapter
          fieldType={FieldType.DATE}
          value={value ? `${value}T00:00:00.000Z` : null}
          onChange={(next) => onChange(typeof next === 'string' ? next.slice(0, 10) : '')}
          disabled={disabled}
          triggerProps={{ className: 'w-full' }}
        />
      </div>
    </div>
  )
}
