// apps/web/src/components/manufacturing/stock-setup/stock-setup-page.tsx
'use client'

// Gated on edit of the `part` def, like the Set counts page it absorbs; an unresolved def id is
// not known rather than denied, since the resource store hydrates asynchronously.

import { ScrollArea } from '@auxx/ui/components/scroll-area'
import { Skeleton } from '@auxx/ui/components/skeleton'
import { useMemo } from 'react'
import { ConnectorCoverageCheck } from '~/components/data-connectors/ui/connector-coverage-check'
import { ToolbarTitle } from '~/components/global/module-toolbar'
import { useRegisterModuleToolbar } from '~/components/global/module-toolbar-outlet'
import { useResourceProperty } from '~/components/resources'
import { useRequireEntityEdit } from '~/providers/capabilities-provider'
import { AccountingStatusLine } from './accounting-status-line'
import { CheckKindsStep } from './check-kinds-step'
import { CountStep } from './count-step'
import { PastBuildsStep } from './past-builds-step'
import { StockSetupSteps } from './stock-setup-steps'
import { useStockSetup } from './use-stock-setup'

const PAGE_DESCRIPTION = 'What each part is, its past builds, and what is on the shelf'

/** Inventory > Stock setup (plans/mrp/17 §5). */
export function StockSetupPage() {
  const partDefId = useResourceProperty('part', 'id')
  useRequireEntityEdit(partDefId)

  useRegisterModuleToolbar(
    useMemo(() => ({ left: <ToolbarTitle hint={PAGE_DESCRIPTION}>Stock setup</ToolbarTitle> }), [])
  )

  const { status, isLoading, states, selected, selectStep, refresh } = useStockSetup()

  return (
    <div className='flex min-h-0 flex-1 flex-col'>
      <AccountingStatusLine />
      <ConnectorCoverageCheck className='mx-4 my-2 shrink-0' />
      <StockSetupSteps states={states} selected={selected} onSelect={selectStep} />
      {isLoading ? (
        <div className='mx-auto flex w-full max-w-3xl flex-col gap-2 p-4 sm:p-6'>
          <Skeleton className='h-16 w-full' />
          <Skeleton className='h-16 w-full' />
        </div>
      ) : selected === 'count' ? (
        <CountStep status={status} />
      ) : (
        <ScrollArea className='min-h-0 flex-1'>
          {selected === 'kinds' ? (
            <CheckKindsStep onChanged={refresh} />
          ) : (
            <PastBuildsStep status={status} onChanged={refresh} />
          )}
        </ScrollArea>
      )}
    </div>
  )
}
