// apps/web/src/components/accounting/ui/settings/import-chart-button.tsx
'use client'

// One component, two doors onto the same mutation (brief 16 §2.2, §2.3):
//
// - `mode='wizard'` is the card the accounts page offers over an EMPTY chart,
//   right next to the pack picker - "take the org's real QuickBooks chart as
//   the source" instead of a template. Never asks mid-import (16 DECIDED):
//   the role-bearing core accounts QuickBooks lacks are created uncoded and
//   unmapped, not held up for a person to answer a question first.
// - `mode='chart'` is the Chart tab's toolbar action, only ever offered once a
//   chart already exists and at least one account is confirmed against the
//   provider - `refreshOnly: true`, so it only ADDS what the provider gained
//   since the last import and never touches the missing-core accounts again.
//
// Both report the result INLINE, never as a success toast (CLAUDE.md - errors
// only) - "12 added, 41 already here" is the whole point of the mutation and
// belongs next to the button that triggered it.

import type { ChartImportResult } from '@auxx/lib/postings/client'
import { Button } from '@auxx/ui/components/button'
import { toastError } from '@auxx/ui/components/toast'
import { CloudDownload } from 'lucide-react'
import { useState } from 'react'
import { api } from '~/trpc/react'

export interface ImportChartButtonProps {
  /** `'wizard'` renders the accounts-page card; `'chart'` renders the toolbar action. */
  mode: 'wizard' | 'chart'
  /** `useAccountingProviderStatus().connected`. Neither mode calls the hook itself - the caller
   *  already reads it for other reasons, and this keeps the component free of that dependency. */
  connected: boolean
  /**
   * Wizard mode's own `chartIsEmpty` gate, passed through rather than re-derived.
   * The wizard's card is only ever supposed to render over an empty chart (16
   * §2.4); when a caller passes `false` here this renders nothing rather than
   * trust the caller to have gated it out already. Ignored in `'chart'` mode,
   * where the Refresh action is exactly the opposite case - a chart that
   * already exists.
   */
  chartIsEmpty?: boolean
  /** Called after a successful import or refresh, in addition to this component's own invalidation. */
  onImported?: (result: ChartImportResult) => void
}

/** "12 added, 41 already here" - counts, never a list of rows. */
function summarise(result: ChartImportResult): string {
  const added = result.created + result.coreCreated.length
  return `${added} added, ${result.alreadyImported} already here`
}

/**
 * Import (or refresh from) the connected provider's chart of accounts.
 *
 * `refreshOnly` follows `mode` directly: the wizard's first import may create
 * the role-bearing core accounts QuickBooks lacks, the Chart tab's refresh
 * never does (16 §2.2 step 5).
 */
export function ImportChartButton({
  mode,
  connected,
  chartIsEmpty,
  onImported,
}: ImportChartButtonProps) {
  const utils = api.useUtils()
  const [summary, setSummary] = useState<string | null>(null)

  const importChart = api.ledger.importChartFromProvider.useMutation({
    onSuccess: async (result) => {
      setSummary(summarise(result))
      await Promise.all([
        utils.ledger.chartAccounts.invalidate(),
        utils.ledger.roleMap.invalidate(),
        utils.ledger.accountMap.invalidate(),
      ])
      onImported?.(result)
    },
    onError: (error) => {
      toastError({
        title: mode === 'chart' ? 'Error refreshing from QuickBooks' : 'Error importing the chart',
        description: error.message,
      })
    },
  })

  if (mode === 'wizard' && chartIsEmpty === false) return null
  if (mode === 'chart' && !connected) return null

  if (mode === 'chart') {
    return (
      <div className='flex flex-wrap items-center gap-2'>
        <Button
          variant='outline'
          size='sm'
          loading={importChart.isPending}
          loadingText='Refreshing...'
          onClick={() => importChart.mutate({ refreshOnly: true })}>
          <CloudDownload />
          Refresh from QuickBooks
        </Button>
        {summary && <span className='text-muted-foreground text-xs'>{summary}</span>}
      </div>
    )
  }

  return (
    <div className='flex flex-col gap-2 rounded-xl border p-3'>
      <p className='font-medium text-sm'>Import from QuickBooks</p>
      {connected ? (
        <>
          <p className='text-muted-foreground text-xs'>
            Bring in every account from your connected QuickBooks company. Accounts it lacks for a
            posting role are added uncoded and unmapped, ready to map or fill in over there.
          </p>
          <div>
            <Button
              variant='outline'
              size='sm'
              loading={importChart.isPending}
              loadingText='Importing...'
              onClick={() => importChart.mutate({ refreshOnly: false })}>
              <CloudDownload />
              Import from QuickBooks
            </Button>
          </div>
          {summary && <p className='text-muted-foreground text-xs'>{summary}</p>}
        </>
      ) : (
        <p className='text-muted-foreground text-xs'>
          Connect QuickBooks on the previous page to import its chart instead of starting from the
          default one.
        </p>
      )}
    </div>
  )
}
