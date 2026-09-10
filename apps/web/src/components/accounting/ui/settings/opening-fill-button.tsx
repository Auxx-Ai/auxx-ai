// apps/web/src/components/accounting/ui/settings/opening-fill-button.tsx
'use client'

// One component, two doors onto the same mutation, exactly like
// `ImportChartButton` (plans/accounting/tasks/19-opening-balances-from-the-provider.md
// section 4.7): the wizard's opening trial balance page and the settings twin
// both render this, so a provider fill looks and reads identically on either
// door.
//
// Reports the outcome INLINE, never as a success toast (CLAUDE.md - errors
// only): what changed, what did not match, and what still needs a count are
// the whole point of the mutation and belong next to the button that
// triggered it.

import { Button } from '@auxx/ui/components/button'
import { CloudDownload } from 'lucide-react'
import { useState } from 'react'
import { formatMoney } from '~/components/money/ui/settings/format-money'
import {
  useDehydratedOrganizationId,
  useDehydratedStateContext,
} from '~/providers/dehydrated-state-provider'
import type { RouterOutputs } from '~/trpc/react'
import { api } from '~/trpc/react'
import { useAccountingProviderStatus } from '../../hooks/use-accounting-provider-status'
import type { LedgerBlocker } from '../ledger/entry-blockers'
import { EntryBlockers } from '../ledger/entry-blockers'

type FillOutcome = RouterOutputs['ledgerOpening']['fillFromProvider']

export interface OpeningFillButtonProps {
  /** The grid is already read-only: a fill whose save would be refused after the click is the
   *  exact failure `wizard-opening-tb-page.tsx` records having been found by driving. */
  frozen: boolean
  /** `null` means the page is showing its own "set a cutoff" note instead of a grid - there is
   *  nothing to suggest into yet. */
  cutoverDate: string | null
  /** Called after a successful fill, in addition to this component's own `ledgerOpening.get`
   *  invalidation - for a caller holding its own grid-edit state to drop it so the fill's rows
   *  show, the same way the page's own `useEffect` resets on a fresh `serverRows` answer. */
  onFilled?: () => void
}

/** "A, B, C" - never a bare count, so the person can tell which accounts to go look at. */
function unmatchedNames(unmatched: FillOutcome['unmatched']): string {
  return unmatched.map((row) => row.name).join(', ')
}

/**
 * The §4.4 card text: the unmatched accounts (with their total) and, when
 * non-zero, the inventory gap - the two pieces of an opening fill's
 * difference that are not a data-entry mistake, just money the fill could not
 * place. `null` when the grid already balances after the fill.
 */
function differenceBlocker(outcome: FillOutcome): LedgerBlocker | null {
  if (outcome.differenceMinor === 0) return null
  if (outcome.unmatched.length === 0 && outcome.inventoryGapMinor === 0) return null

  const currency = outcome.currency
  const sentences: string[] = []

  if (outcome.unmatched.length > 0) {
    // "The whole difference" only when this is the ENTIRE reason the grid is
    // off - the inventory gap is zero and the unmatched total accounts for
    // all of it. Otherwise name the amount and let the two lines add up.
    const isWholeDifference =
      outcome.inventoryGapMinor === 0 &&
      Math.abs(outcome.unmatchedTotalMinor) === Math.abs(outcome.differenceMinor)
    sentences.push(
      `These ${outcome.unmatched.length} QuickBooks accounts have balances and are not in your ` +
        `chart: ${unmatchedNames(outcome.unmatched)}. Together they are ` +
        `${isWholeDifference ? 'the whole difference' : `${formatMoney(Math.abs(outcome.unmatchedTotalMinor), currency)} of the difference`}.`
    )
  }

  if (outcome.inventoryGapMinor !== 0) {
    sentences.push(
      `QuickBooks holds ${formatMoney(Math.abs(outcome.inventoryGapMinor), currency)} of ` +
        'inventory. Enter your count on the Opening inventory page; the difference closes when ' +
        'the two agree.'
    )
  }

  return { status: 'suggestion_incomplete', error: sentences.join(' ') }
}

/**
 * "Suggest from QuickBooks": fill the opening trial balance from the
 * connected accounting provider's balance sheet, and save it through the same
 * write path `ledgerOpening.save` uses.
 *
 * 🛑 This is a SUGGESTION, never an authority (brief 19 DECIDED 1). Every cell
 * the fill lands stays editable afterward, nothing here posts, and the person
 * still presses Continue. On success this only invalidates `ledgerOpening.get`
 * and lets the existing query own the rows - it never merges the outcome into
 * a caller's local edit state, which would race the page's own `useEffect`
 * reset on a fresh `serverRows` answer (brief 19 section 4.7).
 */
export function OpeningFillButton({ frozen, cutoverDate, onFilled }: OpeningFillButtonProps) {
  const utils = api.useUtils()
  const status = useAccountingProviderStatus()
  const organizationId = useDehydratedOrganizationId()
  const { patchSettings } = useDehydratedStateContext()
  const [outcome, setOutcome] = useState<FillOutcome | null>(null)
  const [error, setError] = useState<string | null>(null)

  const fill = api.ledgerOpening.fillFromProvider.useMutation({
    onSuccess: (result) => {
      utils.ledgerOpening.get.invalidate()
      // The fill writes its settings from lib, not through the settings router,
      // so the browser's settings store is not patched by the mutation the way
      // `useSettings` patches it after its own writes. Patch it here, or the
      // instruction paragraph keeps giving the manual advice and page 3's
      // provider column stays blank until a reload.
      if (organizationId) {
        patchSettings(organizationId, {
          'accounting.openingSource': 'provider',
          'accounting.openingSourceAsOf': result.asOf,
          ...(result.inventoryRefusal
            ? {}
            : {
                'accounting.qboOpeningRawMaterials': result.inventory.qboOpeningRawMaterials,
                'accounting.qboOpeningWip': result.inventory.qboOpeningWip,
                'accounting.qboOpeningFinishedGoods': result.inventory.qboOpeningFinishedGoods,
              }),
        })
      }
      setOutcome(result)
      setError(null)
      onFilled?.()
    },
    onError: (mutationError) => {
      setError(mutationError.message)
      setOutcome(null)
    },
  })

  if (!status.connected || frozen || cutoverDate === null) return null

  const providerName = status.providerLabel ?? 'QuickBooks'
  const blockers: LedgerBlocker[] = []
  if (error) {
    blockers.push({ status: 'error', error })
  } else if (outcome) {
    const blocker = differenceBlocker(outcome)
    if (blocker) blockers.push(blocker)
  }

  return (
    <div className='flex flex-col gap-2'>
      <Button
        variant='outline'
        size='sm'
        loading={fill.isPending}
        loadingText='Reading your balance sheet...'
        onClick={() => fill.mutate()}>
        <CloudDownload />
        Suggest from {providerName}
      </Button>

      {outcome && (
        <div className='flex flex-col gap-1'>
          <p className='text-muted-foreground text-xs'>
            Suggested from your QuickBooks balance sheet as of {outcome.asOf}. Check every row -
            these are book balances, not statement balances. {outcome.filledCount} accounts filled.
          </p>
          {outcome.netIncome && (
            <p className='text-muted-foreground text-xs'>
              {/* Debit-positive: a credit balance is income, a debit balance is a loss. */}
              {outcome.netIncome.minorSigned < 0 ? 'Net income' : 'Net loss'} of{' '}
              {formatMoney(Math.abs(outcome.netIncome.minorSigned), outcome.currency)} for the year
              to {outcome.asOf} was folded into retained earnings.
            </p>
          )}
          {outcome.inventoryRefusal && (
            <p className='text-muted-foreground text-xs'>{outcome.inventoryRefusal}</p>
          )}
        </div>
      )}

      {blockers.length > 0 && <EntryBlockers blockers={blockers} />}
    </div>
  )
}
