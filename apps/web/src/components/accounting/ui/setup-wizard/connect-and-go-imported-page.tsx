// apps/web/src/components/accounting/ui/setup-wizard/connect-and-go-imported-page.tsx
'use client'

import { Button } from '@auxx/ui/components/button'
import { PhaseList, useCyclingPhase } from '@auxx/ui/components/phase-list'
import { RefreshCw } from 'lucide-react'
import { useEffect } from 'react'
import { ConnectAndGoDoneList } from './connect-and-go-summary'
import type { ConnectAndGoFlow } from './use-connect-and-go'

const PREPARE_PHASES = ['company', 'chart', 'rails', 'roles', 'providerAccounts', 'banks'] as const

function prepareLabels(providerLabel: string): Record<(typeof PREPARE_PHASES)[number], string> {
  return {
    company: `Reading your ${providerLabel} company settings`,
    chart: 'Importing your chart of accounts',
    rails: 'Setting up payment rails',
    roles: 'Mapping account roles',
    providerAccounts: `Checking accounts ${providerLabel} is missing`,
    banks: 'Matching bank accounts',
  }
}

/** The first import page: runs prepare on reaching it (never on dialog open) and shows what it did. */
export function ConnectAndGoImportedPage({
  flow,
  providerLabel,
}: {
  flow: ConnectAndGoFlow
  providerLabel: string
}) {
  // biome-ignore lint/correctness/useExhaustiveDependencies: `start` runs prepare once per visit.
  useEffect(() => flow.start(), [])
  // Prepare is one call with no progress, so the list cycles until it answers.
  const phase = useCyclingPhase(PREPARE_PHASES, !flow.report && !flow.prepareFailed)

  if (!flow.report) {
    return (
      <div className='flex flex-col gap-3 p-4'>
        <PhaseList
          phases={PREPARE_PHASES}
          labels={prepareLabels(providerLabel)}
          current={phase}
          failed={flow.prepareFailed}
        />
        {flow.prepareFailed ? (
          <div>
            <Button variant='outline' size='sm' onClick={flow.refresh}>
              Try again
            </Button>
          </div>
        ) : (
          <p className='text-muted-foreground text-xs'>
            This reads your whole chart from {providerLabel} and can take a minute.
          </p>
        )}
      </div>
    )
  }

  return (
    <div className='flex flex-col'>
      <ConnectAndGoDoneList report={flow.report} providerLabel={providerLabel} />
      {flow.report.finalized && (
        <p className='px-4 py-3 text-muted-foreground text-sm'>
          Setup is already finalized. Continue to see where things stand.
        </p>
      )}
      {!flow.done && (
        <div className='flex items-center justify-end px-4 py-2'>
          <Button
            variant='ghost'
            size='sm'
            onClick={flow.refresh}
            loading={flow.preparing}
            loadingText='Refreshing...'>
            <RefreshCw />
            Refresh from {providerLabel}
          </Button>
        </div>
      )}
    </div>
  )
}
