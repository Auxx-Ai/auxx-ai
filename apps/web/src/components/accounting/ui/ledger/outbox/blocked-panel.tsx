// apps/web/src/components/accounting/ui/ledger/outbox/blocked-panel.tsx

'use client'

// Accounting > Ledger > Outbox > the BLOCKED tab (91 §4.6): parked accounting work,
// one row per (reasonCode, role, railId, glAccountId[, externalRef]), expandable to its items.

import {
  type WorkItemSourceKind,
  workItemSentence,
  workItemSeverity,
  workItemStatus,
} from '@auxx/lib/accounting/work-items/client'
import { toRecordId } from '@auxx/lib/resources/client'
import { ActionBar } from '@auxx/ui/components/action-bar'
import { toastError } from '@auxx/ui/components/toast'
import { TreeRowButton } from '@auxx/ui/components/tree-row'
import { TreeRowList } from '@auxx/ui/components/tree-row-list'
import {
  CircleAlert,
  CircleSlash,
  Clock,
  ExternalLink,
  Map as MapIcon,
  RefreshCw,
  TriangleAlert,
} from 'lucide-react'
import { useRouter } from 'next/navigation'
import { useCallback, useEffect, useMemo, useState } from 'react'
import { PaymentGatewayAddDialog } from '~/components/accounting/ui/settings/payment-gateway-add-dialog'
import { EmptyState } from '~/components/global/empty-state'
import { InfiniteListTail } from '~/components/global/infinite-list-tail'
import { useBulkMode, useListSelection, useSelectionIds } from '~/components/list-selection'
import { useProviderName } from '~/components/money/ui/provider-payment-notice'
import { RecordBadge } from '~/components/resources/ui/record-badge'
import { useOrgChannel } from '~/realtime/hooks'
import { api, type RouterOutputs } from '~/trpc/react'
import { formatAccountingDate, formatMinor } from '../format'
import { MOVEMENT_PURPOSE_LABEL, WORK_SOURCE_LABEL } from '../type-labels'
import { OutboxRow } from './outbox-row'
import { type OutboxFilters, outboxCategoryInput } from './outbox-toolbar'
import { StandardCostDialog } from './standard-cost-dialog'

type BlockedGroup = RouterOutputs['ledger']['listBlocked']['items'][number]
type BlockedItem = RouterOutputs['ledger']['listBlockedItems']['items'][number]
type GroupKey = Pick<BlockedGroup, 'reasonCode' | 'role' | 'railId' | 'glAccountId'> & {
  externalRef?: string | null
}

/** How often a group being retried re-reads while no realtime frame arrives. */
const RETRYING_REFETCH_MS = 15_000

const groupId = (group: GroupKey) =>
  [
    group.reasonCode,
    group.role ?? '',
    group.railId ?? '',
    group.glAccountId ?? '',
    group.externalRef ?? '',
  ].join('|')

const toGroupKey = ({
  reasonCode,
  role,
  railId,
  glAccountId,
  externalRef,
}: GroupKey): GroupKey => ({
  reasonCode,
  role,
  railId,
  glAccountId,
  externalRef: externalRef ?? null,
})

function sourceLabel(kind: string): string {
  return WORK_SOURCE_LABEL[kind as WorkItemSourceKind] ?? kind
}

/** Severity decides the icon: an error waits for a person, info for a wake. */
function SeverityIcon({ reasonCode }: { reasonCode: string }) {
  if (workItemStatus(reasonCode) === 'skipped')
    return <CircleSlash className='size-4 text-muted-foreground' />
  const severity = workItemSeverity(reasonCode)
  if (severity === 'error') return <CircleAlert className='size-4 text-destructive' />
  if (severity === 'warning') return <TriangleAlert className='size-4 text-amber-500' />
  return <Clock className='size-4 text-muted-foreground' />
}

/** Where the fix for a group is made, when it is a mapping. */
function mapHref(group: GroupKey): string | null {
  if (group.reasonCode === 'ROLE_UNMAPPED' && group.role)
    return `/app/accounting/settings/accounts?role=${encodeURIComponent(group.role)}`
  if (group.reasonCode === 'ACCOUNT_INVALID' && group.glAccountId)
    return `/app/accounting/settings/accounts?s=chart&account=${encodeURIComponent(group.glAccountId)}`
  // With a handle the dialog opens in place; without one the feed is linked on the gateway.
  if (group.reasonCode === 'GATEWAY_UNMAPPED') return '/app/accounting/settings/payment-gateways'
  return null
}

interface BlockedPanelProps {
  filters: OutboxFilters
  emptyAction?: React.ReactNode
  emptyTitle?: string

  /** Owned by `outbox-panel.tsx` so every tab's empty copy is written in one place. */
  emptyDescription: string
  bookTimeZone: string
  /** The movement open in the `?movement=` drawer, so its row reads as the one you are looking at. */
  activeMovementId: string | null
  onSelectMovement: (moneyTransactionId: string) => void
  /** The shipment open in the `?shipment=` drawer. */
  activeShipmentId: string | null
  onSelectShipment: (fulfillmentId: string) => void
}

/** Every parked group, newest first, with Map and Retry all per row and over a selection. */
export function BlockedPanel({
  filters,
  emptyAction,
  emptyTitle,
  emptyDescription,
  bookTimeZone,
  activeMovementId,
  onSelectMovement,
  activeShipmentId,
  onSelectShipment,
}: BlockedPanelProps) {
  const utils = api.useUtils()
  const router = useRouter()
  const query = {
    search: filters.search || undefined,
    from: filters.from || undefined,
    to: filters.to || undefined,
    categories: outboxCategoryInput(filters),
  }
  const list = api.ledger.listBlocked.useInfiniteQuery(query, {
    getNextPageParam: (page) => page.nextCursor,
    // The net under a lost frame: re-read while anything is waiting on the sweep.
    refetchInterval: (q) =>
      q.state.data?.pages.some((page) => page.items.some((group) => group.dueCount > 0))
        ? RETRYING_REFETCH_MS
        : false,
  })
  const groups = useMemo(() => list.data?.pages.flatMap((page) => page.items) ?? [], [list.data])
  const groupsById = useMemo(
    () => new Map(groups.map((group) => [groupId(group), group])),
    [groups]
  )
  const [open, setOpen] = useState<ReadonlySet<string>>(new Set())

  const selectedIds = useSelectionIds()
  const selecting = useBulkMode()
  const setItemIds = useListSelection((state) => state.setItemIds)
  const exitSelection = useListSelection((state) => state.exit)
  useEffect(() => {
    setItemIds(groups.map(groupId))
  }, [groups, setItemIds])

  const refresh = useCallback(() => {
    void utils.ledger.listBlocked.invalidate()
    void utils.ledger.listBlockedItems.invalidate()
    void utils.ledger.outboxCounts.invalidate()
  }, [utils])

  const onEvent = useCallback(
    (event: string) => {
      if (event === 'accountingWork:changed') refresh()
    },
    [refresh]
  )
  useOrgChannel({ onEvent })

  // The handle a Map click opened the add dialog for.
  const [mapHandle, setMapHandle] = useState<string | null>(null)
  // The part a Map click opened the standard-cost dialog for.
  const [costPartId, setCostPartId] = useState<string | null>(null)

  // Retry all makes the rows due now and returns; the recovery job posts them (91 §4.6).
  const retry = api.ledger.retryBlockedGroup.useMutation({
    onSuccess: refresh,
    onError: (error) => toastError({ title: 'Could not retry', description: error.message }),
  })

  async function retryMany(ids: string[]) {
    try {
      for (const id of ids) {
        const group = groupsById.get(id)
        if (group) await retry.mutateAsync({ group: toGroupKey(group) })
      }
    } catch {
      // `onError` already said so.
    }
    exitSelection()
  }

  function toggle(id: string) {
    setOpen((current) => {
      const next = new Set(current)
      if (next.has(id)) next.delete(id)
      else next.add(id)
      return next
    })
  }

  function renderGroup(group: BlockedGroup) {
    const id = groupId(group)
    const busy =
      retry.isPending && !!retry.variables && 'group' in retry.variables
        ? groupId(retry.variables.group) === id
        : false
    const sentence = workItemSentence(group.reasonCode, group)
    const where = [group.railName, group.glAccountName].filter(Boolean).join(', ')
    const noun =
      group.sourceKinds.length === 1 ? sourceLabel(group.sourceKinds[0] ?? '') : 'Records'
    const href = mapHref(group)
    // The group's `externalRef` is the gateway handle, or the part missing its standard cost.
    const mapInPlace =
      (group.reasonCode === 'GATEWAY_UNMAPPED' || group.reasonCode === 'STANDARD_COST_MISSING') &&
      !!group.externalRef
    const retrying = group.dueCount > 0
    return (
      <OutboxRow
        id={id}
        icon={<SeverityIcon reasonCode={group.reasonCode} />}
        date={formatAccountingDate(group.latestAt.toISOString(), bookTimeZone)}
        typeLabel={noun}
        title={`${group.count} waiting${where ? ` (${where})` : ''}: ${sentence}`}
        description={sentence}
        amount={retrying ? `Retrying ${group.dueCount}…` : ''}
        expandable
        isOpen={open.has(id)}
        onToggleOpen={() => toggle(id)}
        actions={
          <>
            {mapInPlace ? (
              <TreeRowButton
                persistent
                tooltipText='Map it'
                onClick={() =>
                  group.reasonCode === 'STANDARD_COST_MISSING'
                    ? setCostPartId(group.externalRef)
                    : setMapHandle(group.externalRef)
                }>
                <MapIcon />
              </TreeRowButton>
            ) : (
              href && (
                <TreeRowButton persistent tooltipText='Map it' onClick={() => router.push(href)}>
                  <MapIcon />
                </TreeRowButton>
              )
            )}
            <TreeRowButton
              persistent
              tooltipText={retrying ? `Retrying ${group.dueCount}…` : 'Retry all'}
              disabled={busy || retrying}
              onClick={() => retry.mutate({ group: toGroupKey(group) })}>
              <RefreshCw className={busy || retrying ? 'animate-spin' : undefined} />
            </TreeRowButton>
          </>
        }
        selectLabel={`Select ${noun} - ${sentence}`}>
        {open.has(id) && (
          <BlockedGroupItems
            group={toGroupKey(group)}
            query={query}
            bookTimeZone={bookTimeZone}
            activeMovementId={activeMovementId}
            onSelectMovement={onSelectMovement}
            activeShipmentId={activeShipmentId}
            onSelectShipment={onSelectShipment}
            onRetry={(item) =>
              retry.mutate({ source: { sourceKind: item.sourceKind, sourceId: item.sourceId } })
            }
          />
        )}
      </OutboxRow>
    )
  }

  return (
    <div className={`flex flex-1 flex-col gap-3 p-3 ${groups.length > 0 ? 'pb-16' : ''}`}>
      {!list.isPending && groups.length === 0 ? (
        <EmptyState
          className='py-8'
          icon={CircleAlert}
          title={emptyTitle ?? 'Nothing is waiting'}
          description={emptyDescription}
          button={emptyAction}
        />
      ) : (
        <>
          <TreeRowList
            items={groups}
            loading={list.isPending}
            skeletonCount={4}
            className='gap-px'
            getKey={groupId}
            renderRow={renderGroup}
          />
          <InfiniteListTail
            hasNextPage={list.hasNextPage}
            isFetchingNextPage={list.isFetchingNextPage}
            fetchNextPage={list.fetchNextPage}
            loadingLabel='Loading more...'
          />
        </>
      )}

      <ActionBar
        open={selecting}
        onOpenChange={(next) => !next && exitSelection()}
        duration={Number.POSITIVE_INFINITY}
        position='bottom-center'
        selectedCount={selectedIds.length}
        selectedLabel='selected'
        showClose
        actions={[
          {
            id: 'retry',
            label: 'Retry all',
            icon: RefreshCw,
            disabled: retry.isPending,
            onClick: () => void retryMany(selectedIds),
          },
        ]}
      />
      <PaymentGatewayAddDialog
        open={mapHandle !== null}
        onOpenChange={(next) => {
          if (!next) setMapHandle(null)
        }}
        initialHandle={mapHandle ?? undefined}
        onCreated={refresh}
      />
      <StandardCostDialog
        partId={costPartId}
        onOpenChange={(next) => {
          if (!next) setCostPartId(null)
        }}
      />
    </div>
  )
}

interface BlockedGroupItemsProps {
  group: GroupKey
  query: {
    search?: string
    from?: string
    to?: string
    categories?: ReturnType<typeof outboxCategoryInput>
  }
  bookTimeZone: string
  activeMovementId: string | null
  onSelectMovement: (moneyTransactionId: string) => void
  activeShipmentId: string | null
  onSelectShipment: (fulfillmentId: string) => void
  onRetry: (item: BlockedItem) => void
}

/** One group's items, paged; a movement or a shipment opens its drawer. */
function BlockedGroupItems({
  group,
  query,
  bookTimeZone,
  activeMovementId,
  onSelectMovement,
  activeShipmentId,
  onSelectShipment,
  onRetry,
}: BlockedGroupItemsProps) {
  const providerName = useProviderName()
  const list = api.ledger.listBlockedItems.useInfiniteQuery(
    { ...query, group },
    { getNextPageParam: (page) => page.nextCursor }
  )
  const items = list.data?.pages.flatMap((page) => page.items) ?? []

  return (
    <>
      {items.map((item) => {
        const movementId = item.moneyTransactionId
        const onOpen =
          item.sourceKind === 'fulfillment'
            ? () => onSelectShipment(item.sourceId)
            : movementId
              ? () => onSelectMovement(movementId)
              : undefined
        const active =
          item.sourceKind === 'fulfillment'
            ? activeShipmentId === item.sourceId
            : !!movementId && activeMovementId === movementId
        const typeLabel = item.purpose
          ? (MOVEMENT_PURPOSE_LABEL[item.purpose as keyof typeof MOVEMENT_PURPOSE_LABEL] ??
            sourceLabel(item.sourceKind))
          : sourceLabel(item.sourceKind)
        return (
          <OutboxRow
            key={item.id}
            id={item.id}
            depth={1}
            selectable={false}
            date={formatAccountingDate(item.updatedAt.toISOString(), bookTimeZone)}
            typeLabel={typeLabel}
            title={item.label ?? item.externalRef ?? item.sourceId}
            description={workItemSentence(item.reasonCode, item)}
            secondary={
              item.recordDefinitionId ? (
                <RecordBadge
                  recordId={toRecordId(item.recordDefinitionId, item.sourceId)}
                  size='sm'
                />
              ) : undefined
            }
            amount={
              item.amountMinor !== null && item.currency
                ? formatMinor(item.amountMinor, item.currency)
                : ''
            }
            actions={
              <>
                {item.providerObjectUrl && (
                  <TreeRowButton
                    persistent
                    tooltipText={`Open in ${providerName}`}
                    aria-label={`Open in ${providerName}`}
                    onClick={() => window.open(item.providerObjectUrl ?? '', '_blank', 'noopener')}>
                    <ExternalLink />
                  </TreeRowButton>
                )}
                <TreeRowButton persistent tooltipText='Retry' onClick={() => onRetry(item)}>
                  <RefreshCw />
                </TreeRowButton>
              </>
            }
            onOpen={onOpen}
            active={active}
            selectLabel={item.label ?? item.sourceId}
          />
        )
      })}
      {list.hasNextPage && (
        <InfiniteListTail
          hasNextPage={list.hasNextPage}
          isFetchingNextPage={list.isFetchingNextPage}
          fetchNextPage={list.fetchNextPage}
          loadingLabel='Loading more...'
        />
      )}
    </>
  )
}
