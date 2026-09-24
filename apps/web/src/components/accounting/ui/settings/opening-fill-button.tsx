// apps/web/src/components/accounting/ui/settings/opening-fill-button.tsx
'use client'

// Fill the opening from the connected accounting system's balance sheet at the cutover,
// inventory included (plans/accounting/tasks/103 §5a). Reports the outcome inline, never
// as a success toast; a refusal (an account with a balance and no counterpart in the
// chart) is the server's own sentence, naming the accounts.

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
import { EntryBlockers } from '../ledger/entry-blockers'

type FillOutcome = RouterOutputs['ledgerOpening']['fillFromProvider']

export interface OpeningFillButtonProps {
  /** The grid is read-only, so a fill would be refused after the click. */
  frozen: boolean
  /** `null` while no cutoff is set - there is nothing to fill into yet. */
  cutoverDate: string | null
  /** Called after a successful fill, for a caller holding its own grid edits to drop them. */
  onFilled?: () => void
}

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
      // The fill writes its provenance from lib, so the browser store is patched by hand.
      if (organizationId) {
        patchSettings(organizationId, {
          'accounting.openingSource': 'provider',
          'accounting.openingSourceAsOf': result.asOf,
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

  const providerName = status.providerLabel ?? 'your accounting system'

  return (
    <div className='flex flex-col gap-2'>
      <Button
        variant='outline'
        size='sm'
        loading={fill.isPending}
        loadingText='Reading your balance sheet...'
        onClick={() => fill.mutate()}>
        <CloudDownload />
        Fill from {providerName}
      </Button>

      {outcome && (
        <div className='flex flex-col gap-1'>
          <p className='text-muted-foreground text-xs'>
            Filled from the balance sheet as of {outcome.asOf}, inventory included.{' '}
            {outcome.filledCount} accounts filled.
          </p>
          {outcome.netIncome && (
            <p className='text-muted-foreground text-xs'>
              {/* Debit-positive: a credit balance is income, a debit balance is a loss. */}
              {outcome.netIncome.minorSigned < 0 ? 'Net income' : 'Net loss'} of{' '}
              {formatMoney(Math.abs(outcome.netIncome.minorSigned), outcome.currency)} for the year
              to {outcome.asOf} was folded into retained earnings.
            </p>
          )}
        </div>
      )}

      {error && <EntryBlockers blockers={[{ status: 'error', error }]} />}
    </div>
  )
}
