// apps/web/src/components/accounting/ui/ledger/outbox-page.tsx

'use client'

import {
  OUTBOX_TAB_PARAMS,
  type OutboxTab,
  parseOutboxTab,
} from '@auxx/lib/accounting/export/client'
import { PermissionKey } from '@auxx/lib/permissions/client'
import { Button } from '@auxx/ui/components/button'
import { Separator } from '@auxx/ui/components/separator'
import { toastError } from '@auxx/ui/components/toast'
import { Hammer } from 'lucide-react'
import { parseAsStringLiteral, useQueryState } from 'nuqs'
import { useCallback, useMemo, useState } from 'react'
import { useRegisterAccountingToolbar } from '~/components/accounting/accounting-toolbar-outlet'
import {
  UNKNOWN_PROVIDER_LABEL,
  useAccountingProviderStatus,
} from '~/components/accounting/hooks/use-accounting-provider-status'
import { useLedgerPeriod } from '~/components/accounting/hooks/use-ledger-period'
import { ToolbarTitle } from '~/components/accounting/ui/accounting-toolbar'
import { today } from '~/components/accounting/ui/journal/period-helpers'
import { useAccess } from '~/providers/capabilities-provider'
import { api, type RouterOutputs } from '~/trpc/react'

import { formatPeriodLabel } from './format'
import { MonthDropdown, ProviderPill } from './ledger-toolbar'
import { buildResultSentence, OutboxPanel } from './outbox/outbox-panel'
import { OUTBOX_TAB_PARAM } from './outbox-route'
import { useLedgerDrawers } from './use-ledger-drawers'

type OutboxCounts = RouterOutputs['ledger']['outboxCounts']

/** 🛑 `sent` is not counted: the topbar figure is about what is OUTSTANDING. */
function outstanding(counts: OutboxCounts | undefined): number {
  if (!counts) return 0
  return counts.blocked + counts.unbuilt + counts.ready + counts.sending + counts.failed
}

/**
 * The Outbox, at `/app/accounting/outbox` — everything on its way out of the
 * books: `blocked`, then the export-batch states, over `?tab=`.
 *
 * 🛑 NO month nav and NO period pill in the topbar, unlike Closeout. Every tab
 * here reads with no month bound, so "September" over a list reaching back
 * eighteen months is a false claim — the complaint
 * 81-one-accounting-shell.md was opened to settle (§4). The month survives only
 * on Build, which freezes one month's POSTED entries into batches and is the one
 * thing that genuinely is month-scoped.
 */
export function OutboxPage() {
  const period = useLedgerPeriod()
  const provider = useAccountingProviderStatus()
  const utils = api.useUtils()
  const { can } = useAccess()
  const canRelease = can(PermissionKey.ledgerPost)
  const providerLabel = provider.providerLabel ?? UNKNOWN_PROVIDER_LABEL

  const [tabParam, setTabParam] = useQueryState(
    OUTBOX_TAB_PARAM,
    parseAsStringLiteral(OUTBOX_TAB_PARAMS)
  )
  const tab = parseOutboxTab(tabParam) ?? 'ready'
  const selectTab = useCallback((next: OutboxTab) => void setTabParam(next), [setTabParam])

  /**
   * Build's month, local to this screen rather than `?month=`: it is the
   * argument to one mutation, not a claim about what the list below is showing.
   * `null` means "whatever resolved".
   */
  const [chosenBuildMonth, setChosenBuildMonth] = useState<string | null>(null)
  const buildMonth = chosenBuildMonth ?? period.resolvedPeriodKey
  const buildMonthLabel = buildMonth ? formatPeriodLabel(buildMonth) : ''

  const drawers = useLedgerDrawers({
    periodKey: buildMonth,
    currencyCode: period.currencyCode,
    bookTimeZone: period.bookTimeZone,
    providerLabel,
    defaultEntryDate: today(period.bookTimeZone),
  })

  const countsQuery = api.ledger.outboxCounts.useQuery()
  const outstandingCount = outstanding(countsQuery.data)

  const build = api.ledger.exportBatches.build.useMutation({
    onSuccess: () => {
      void utils.ledger.exportBatches.list.invalidate()
      void utils.ledger.outboxCounts.invalidate()
    },
    onError: (error) => toastError({ title: 'Error building batches', description: error.message }),
  })
  const [buildResult, setBuildResult] = useState<Awaited<
    ReturnType<typeof build.mutateAsync>
  > | null>(null)

  const buildMutate = build.mutate
  const handleBuild = useCallback(() => {
    if (!buildMonth) return
    setBuildResult(null)
    buildMutate({ periodKey: buildMonth }, { onSuccess: (result) => setBuildResult(result) })
  }, [buildMonth, buildMutate])

  const toolbar = useMemo(
    () => ({
      left: (
        <ToolbarTitle hint='all periods' count={outstandingCount}>
          Outbox
        </ToolbarTitle>
      ),
      right: canRelease ? (
        <>
          <Button
            variant='ghost'
            size='sm'
            disabled={!buildMonth}
            loading={build.isPending}
            loadingText='Building…'
            onClick={handleBuild}>
            <Hammer />
            Build batches
          </Button>
          <MonthDropdown
            periodKey={buildMonth}
            options={period.options}
            onSelectPeriod={setChosenBuildMonth}
            className='min-w-[8.5rem]'
          />
          <Separator orientation='vertical' className='h-6' />
          <ProviderPill />
        </>
      ) : (
        <ProviderPill />
      ),
    }),
    [build.isPending, buildMonth, canRelease, handleBuild, outstandingCount, period.options]
  )
  useRegisterAccountingToolbar(toolbar)

  return (
    <div className='flex min-h-0 flex-1 flex-col'>
      <OutboxPanel
        tab={tab}
        onTabChange={selectTab}
        buildMonthLabel={buildMonthLabel}
        buildNotice={
          buildResult ? (
            <p className='shrink-0 px-3 pt-3 text-muted-foreground text-xs'>
              {buildResultSentence(buildResult, buildMonthLabel || 'this month')}
            </p>
          ) : null
        }
        bookTimeZone={period.bookTimeZone}
        providerLabel={providerLabel}
        activePostingId={drawers.postingId}
        onSelectPosting={drawers.openPosting}
        activeMovementId={drawers.movementId}
        onSelectMovement={drawers.openMovement}
        activeShipmentId={drawers.shipmentId}
        onSelectShipment={drawers.openShipment}
      />

      {drawers.overlays}
    </div>
  )
}
