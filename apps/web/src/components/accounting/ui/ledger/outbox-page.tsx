// apps/web/src/components/accounting/ui/ledger/outbox-page.tsx

'use client'

import {
  OUTBOX_GROUP_BYS,
  OUTBOX_ORDERS,
  OUTBOX_TAB_PARAMS,
  OUTBOX_VIEWS,
  type OutboxGroupBy,
  type OutboxOrder,
  type OutboxTab,
  type OutboxView,
  parseOutboxTab,
} from '@auxx/lib/accounting/export/client'
import { parseAsStringLiteral, useQueryState } from 'nuqs'
import { useCallback, useMemo } from 'react'
import { useRegisterAccountingToolbar } from '~/components/accounting/accounting-toolbar-outlet'
import {
  UNKNOWN_PROVIDER_LABEL,
  useAccountingProviderStatus,
} from '~/components/accounting/hooks/use-accounting-provider-status'
import { useLedgerPeriod } from '~/components/accounting/hooks/use-ledger-period'
import { ToolbarTitle } from '~/components/accounting/ui/accounting-toolbar'
import { today } from '~/components/accounting/ui/journal/period-helpers'
import { api, type RouterOutputs } from '~/trpc/react'

import { ProviderPill } from './ledger-toolbar'
import { OutboxPanel } from './outbox/outbox-panel'
import {
  OUTBOX_GROUP_PARAM,
  OUTBOX_ORDER_PARAM,
  OUTBOX_TAB_PARAM,
  OUTBOX_VIEW_PARAM,
} from './outbox-route'
import { useLedgerDrawers } from './use-ledger-drawers'

type OutboxCounts = RouterOutputs['ledger']['outboxCounts']

/** 🛑 `sent` is not counted: the topbar figure is about what is OUTSTANDING. */
function outstanding(counts: OutboxCounts | undefined): number {
  if (!counts) return 0
  return counts.blocked + counts.unbuilt + counts.ready + counts.sending + counts.failed
}

/**
 * The Outbox, at `/app/accounting/outbox` — everything on its way out of the
 * books: `blocked`, then the export states, over `?tab=`.
 * No month in the topbar: every tab reads across all periods (81 §4).
 */
export function OutboxPage() {
  const period = useLedgerPeriod()
  const provider = useAccountingProviderStatus()
  const providerLabel = provider.providerLabel ?? UNKNOWN_PROVIDER_LABEL

  const [tabParam, setTabParam] = useQueryState(
    OUTBOX_TAB_PARAM,
    parseAsStringLiteral(OUTBOX_TAB_PARAMS)
  )
  const tab = parseOutboxTab(tabParam) ?? 'ready'
  const selectTab = useCallback((next: OutboxTab) => void setTabParam(next), [setTabParam])

  const [groupBy, setGroupBy] = useQueryState(
    OUTBOX_GROUP_PARAM,
    parseAsStringLiteral(OUTBOX_GROUP_BYS)
  )
  const [orderParam, setOrderParam] = useQueryState(
    OUTBOX_ORDER_PARAM,
    parseAsStringLiteral(OUTBOX_ORDERS)
  )
  const order: OutboxOrder = orderParam ?? 'desc'
  const selectGroupBy = useCallback(
    (next: OutboxGroupBy | null) => void setGroupBy(next),
    [setGroupBy]
  )
  const selectOrder = useCallback((next: OutboxOrder) => void setOrderParam(next), [setOrderParam])
  const [view, setView] = useQueryState(OUTBOX_VIEW_PARAM, parseAsStringLiteral(OUTBOX_VIEWS))
  const selectView = useCallback((next: OutboxView) => void setView(next), [setView])

  const drawers = useLedgerDrawers({
    periodKey: period.resolvedPeriodKey,
    currencyCode: period.currencyCode,
    bookTimeZone: period.bookTimeZone,
    providerLabel,
    defaultEntryDate: today(period.bookTimeZone),
  })

  const countsQuery = api.ledger.outboxCounts.useQuery()
  const outstandingCount = outstanding(countsQuery.data)

  const toolbar = useMemo(
    () => ({
      left: (
        <ToolbarTitle hint='all periods' count={outstandingCount}>
          Outbox
        </ToolbarTitle>
      ),
      right: <ProviderPill />,
    }),
    [outstandingCount]
  )
  useRegisterAccountingToolbar(toolbar)

  return (
    <div className='flex min-h-0 flex-1 flex-col'>
      <OutboxPanel
        tab={tab}
        onTabChange={selectTab}
        groupBy={groupBy}
        onGroupByChange={selectGroupBy}
        order={order}
        onOrderChange={selectOrder}
        view={view}
        onViewChange={selectView}
        currencyCode={period.currencyCode}
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
