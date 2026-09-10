// apps/web/src/components/accounting/ui/provider-agreement/provider-agreement-panel.tsx

'use client'

// "Do our books and theirs agree as of this date, and if not, where"
// (plans/accounting/tasks/20-two-authors-one-ledger.md §8.3), as one component
// behind both doors: the close console renders it on the period already on
// screen, and Accounting > Settings renders it with a date field for an
// arbitrary date.
//
// 🛑 ON DEMAND ONLY. `ledger.providerAgreement` reaches the connected system
// over the app Lambda, and the drift it detects is caused by the accountant's
// adjusting work, which happens at close - so there is no polling, no refetch
// interval, no refetch on focus or on mount, and no background job (§8.3). The
// query does not run until somebody presses the button. If the button turns out
// to be pressed constantly, that is the signal to tighten the cadence, and by
// then there is data to justify it.
//
// 🛑 Reports its outcome INLINE, never as a toast - the same rule the rest of
// the accounting module follows (ground rule 9, `entry-blockers.tsx`). A
// refusal here names two accounts and where to go and unpick them; a toast
// would take that away three seconds later.

import { FieldType } from '@auxx/database/enums'
import { Button } from '@auxx/ui/components/button'
import { Skeleton } from '@auxx/ui/components/skeleton'
import { cn } from '@auxx/ui/lib/utils'
import { Scale } from 'lucide-react'
import { useState } from 'react'
import { FieldInputAdapter } from '~/components/fields/inputs/field-input-adapter'
import { useSettings } from '~/hooks/use-settings'
import { api } from '~/trpc/react'
import { useAccountingProviderStatus } from '../../hooks/use-accounting-provider-status'
import { EntryBlockers } from '../ledger/entry-blockers'
import { ProviderAgreementTable } from './provider-agreement-table'

/** What `quickbooks-section.tsx` says about a disconnected org, said the same way. */
const NOT_CONNECTED_COPY =
  'No accounting system is connected, so there is nothing to compare against. The books are kept ' +
  'here either way and nothing is blocked by this.'

export interface ProviderAgreementPanelProps {
  /** `YYYY-MM-DD`. Both sides are read as of this day. */
  asOf: string
  /**
   * Given, the panel renders a date field beside the button and the caller owns
   * the date - the settings door, where the date is arbitrary. Omitted, the date
   * is fixed by the caller and no field renders - the close console, where it is
   * the end of the period already on screen.
   */
  onAsOfChange?: (asOf: string) => void
  className?: string
}

/**
 * The agreement view: a button, and whatever the last press answered.
 *
 * Four outcomes, and the first three must never be flattened into each other:
 *
 *   1. Nothing is connected -> {@link NOT_CONNECTED_COPY}, and the button is
 *      disabled. Known without asking, from `useAccountingProviderStatus`, and
 *      confirmed by the server's own `not_connected` for the org that installed
 *      the app but never authorized it.
 *   2. Connected, empty company -> `ProviderAgreementTable` says so.
 *   3. Connected, zero difference -> the table says the books AGREE.
 *   4. A refusal (one provider account claimed by two of ours) -> an
 *      `EntryBlockers` card carrying the server's message verbatim, which is
 *      what names both accounts.
 */
export function ProviderAgreementPanel({
  asOf,
  onAsOfChange,
  className,
}: ProviderAgreementPanelProps) {
  const provider = useAccountingProviderStatus()
  const { getSetting } = useSettings({ scope: 'GENERAL' })
  const currency = (getSetting('organization.currency') as string) || 'USD'

  /**
   * The date the last press asked about, or `null` for "nothing has been asked".
   *
   * 🛑 This is what keeps the read on demand. `enabled` is false until somebody
   * presses the button, and moving the date field clears it again rather than
   * leaving February's answer on screen under a March heading.
   */
  const [runAsOf, setRunAsOf] = useState<string | null>(null)

  const agreementQuery = api.ledger.providerAgreement.useQuery(
    { asOf: runAsOf ?? asOf },
    {
      enabled: runAsOf !== null,
      // 🛑 Every one of these is load-bearing, not defensive tuning: this read
      // costs a round trip to the connected system, so nothing but the button
      // may cause it to happen (§8.3).
      refetchOnWindowFocus: false,
      refetchOnMount: false,
      refetchOnReconnect: false,
      refetchInterval: false,
      staleTime: Number.POSITIVE_INFINITY,
      retry: false,
    }
  )

  const providerLabel = provider.providerLabel ?? 'QuickBooks'
  const isCurrent = runAsOf === asOf
  const isRunning = agreementQuery.isFetching

  function run() {
    // Re-asking the SAME date has to go through `refetch` - the query key has
    // not changed, so `setRunAsOf` alone would be a no-op and the button would
    // do nothing at all on its second press.
    if (isCurrent) void agreementQuery.refetch()
    else setRunAsOf(asOf)
  }

  const data = isCurrent ? agreementQuery.data : undefined
  const error = isCurrent ? agreementQuery.error : null

  return (
    <div className={cn('flex flex-col gap-3', className)}>
      <div className='flex flex-wrap items-center gap-2'>
        {onAsOfChange && (
          <>
            <span className='text-muted-foreground text-sm'>As of</span>
            <div className='w-44'>
              {/* The date is held as `YYYY-MM-DD` (that is what the procedure
                  takes), so it is widened to an instant on the way in and
                  sliced back on the way out - the same round trip the JE drawer
                  and the deposit form do. */}
              <FieldInputAdapter
                fieldType={FieldType.DATE}
                value={`${asOf}T00:00:00.000Z`}
                onChange={(value) => {
                  const iso = value as string | null
                  if (!iso) return
                  onAsOfChange(iso.slice(0, 10))
                  // The answer on screen belongs to the old date. Drop it rather
                  // than relabel it.
                  setRunAsOf(null)
                }}
                disabled={isRunning}
                triggerProps={{ className: 'w-full' }}
              />
            </div>
          </>
        )}

        <Button
          variant='outline'
          size='sm'
          disabled={!provider.connected}
          loading={isRunning}
          loadingText={`Reading ${providerLabel}...`}
          onClick={run}>
          <Scale />
          {isCurrent && data ? 'Check again' : 'Check agreement'}
        </Button>

        {isCurrent && data?.status === 'ok' && (
          <span className='text-muted-foreground text-xs'>
            Compared as of {data.agreement.asOf}.
          </span>
        )}
      </div>

      {!provider.connected && !provider.loading && (
        <p className='text-muted-foreground text-xs'>{NOT_CONNECTED_COPY}</p>
      )}

      {/*
        🛑 Two different failures, and only one of them is a REFUSAL. A provider
        account claimed by two of ours comes back 422 with a message naming both,
        and that gets the blocker card with the remedy on it. Anything else - the
        Lambda timed out, QuickBooks faulted, the token expired - is a read that
        did not run, and dressing it up as "the two charts cannot be lined up"
        would send somebody to unpick a mapping that is fine. Same distinction
        the close console's balance sweep draws between a failed read and a
        running one.
      */}
      {error &&
        (error.data?.httpStatus === 422 ? (
          <EntryBlockers blockers={[{ status: 'agreement_refused', error: error.message }]} />
        ) : (
          <p className='text-destructive text-sm'>
            The comparison could not run, so nothing has been checked. {error.message}
          </p>
        ))}

      {isRunning && !data && <Skeleton className='h-40 w-full' />}

      {/* The server's own "nothing is connected", which is a different fact
          from the browser's: an org that installed the app but never authorized
          it reads `connected: false` above AND reaches the adapter, which
          answers `not_connected`. Both say the same thing, so both say it the
          same way. */}
      {data?.status === 'not_connected' && (
        <p className='text-muted-foreground text-sm'>{NOT_CONNECTED_COPY}</p>
      )}

      {data?.status === 'ok' && (
        <ProviderAgreementTable
          agreement={data.agreement}
          currency={currency}
          providerCurrency={data.providerCurrency}
          providerLabel={providerLabel}
        />
      )}
    </div>
  )
}
