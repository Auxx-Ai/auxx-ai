// apps/web/src/components/accounting/ui/ledger/outbox/blocked-panel.tsx

'use client'

// Accounting > Ledger > Outbox > the BLOCKED tab (75-D1). One row per
// `MoneyTransaction` the ledger refused: the money moved, nothing was written,
// and `postingBlockedReason` holds the reason.
//
// 🛑 The refusal is rendered in the server's own words, never paraphrased -
// on the row's help icon, and in full with the remedy card in the movement
// drawer (`movement-drawer.tsx`) a row opens.

import { toRecordId } from '@auxx/lib/resources/client'
import { ActionBar } from '@auxx/ui/components/action-bar'
import { toastError } from '@auxx/ui/components/toast'
import { TreeRowButton } from '@auxx/ui/components/tree-row'
import { TreeRowList } from '@auxx/ui/components/tree-row-list'
import { CircleAlert, RefreshCw } from 'lucide-react'
import { useEffect, useMemo, useState } from 'react'
import { EmptyState } from '~/components/global/empty-state'
import { InfiniteListTail } from '~/components/global/infinite-list-tail'
import { useBulkMode, useListSelection, useSelectionIds } from '~/components/list-selection'
import { RecordBadge } from '~/components/resources/ui/record-badge'
import { api, type RouterOutputs } from '~/trpc/react'
import { formatAccountingDate, formatMinor } from '../format'
import { MOVEMENT_PURPOSE_LABEL } from '../type-labels'
import { OutboxRow } from './outbox-row'

/** The server's row, never rebuilt here - `listBlockedMovements` owns the shape. */
type BlockedMovementRow = RouterOutputs['ledger']['listBlockedMovements']['items'][number]

/** What the ingest acceptance behind the movement is waiting for, when there is one (79 §4.4). */
function acceptanceWait(row: BlockedMovementRow): string | null {
  if (!row.acceptanceWaitingOn) return null
  const wait = row.acceptanceWaitingOn === 'change' ? 'Waiting on a change' : 'Waiting to try again'
  return row.acceptanceAttempts ? `${wait} - ${row.acceptanceAttempts} attempts` : wait
}

interface BlockedPanelProps {
  /** Owned by `outbox-panel.tsx` so every tab's empty copy is written in one place. */
  emptyDescription: string
  bookTimeZone: string
  /** The movement open in the `?movement=` drawer, so its row reads as the one you are looking at. */
  activeMovementId: string | null
  onSelectMovement: (moneyTransactionId: string) => void
}

/** Every parked movement, newest refusal first, paged, with Retry per row and over a selection. */
export function BlockedPanel({
  emptyDescription,
  bookTimeZone,
  activeMovementId,
  onSelectMovement,
}: BlockedPanelProps) {
  const utils = api.useUtils()
  const list = api.ledger.listBlockedMovements.useInfiniteQuery(
    {},
    { getNextPageParam: (page) => page.nextCursor }
  )
  const rows = useMemo(() => list.data?.pages.flatMap((page) => page.items) ?? [], [list.data])

  const selectedIds = useSelectionIds()
  const selecting = useBulkMode()
  const setItemIds = useListSelection((state) => state.setItemIds)
  const exitSelection = useListSelection((state) => state.exit)
  useEffect(() => {
    setItemIds(rows.map((row) => row.id))
  }, [rows, setItemIds])

  const [retryingMany, setRetryingMany] = useState(false)

  function refresh() {
    void utils.ledger.listBlockedMovements.invalidate()
    void utils.ledger.listDrafts.invalidate()
    void utils.ledger.listPostings.invalidate()
    void utils.ledger.outboxCounts.invalidate()
  }

  const retry = api.ledger.retryBlockedMovement.useMutation()

  function retryOne(moneyTransactionId: string) {
    retry.mutate(
      { moneyTransactionId },
      {
        onSuccess: (result) => {
          if (result.status !== 'accepted')
            toastError({
              title: 'Still not posted',
              description: 'reason' in result ? result.reason : 'It is waiting for approval.',
            })
          refresh()
        },
        onError: (error) => toastError({ title: 'Could not retry', description: error.message }),
      }
    )
  }

  /** Sequential - a retry is a post, and forty at once would race the same period claim. */
  async function retryMany(ids: string[]) {
    setRetryingMany(true)
    let stillBlocked = 0
    for (const moneyTransactionId of ids) {
      try {
        const result = await retry.mutateAsync({ moneyTransactionId })
        if (result.status !== 'accepted') stillBlocked++
      } catch {
        stillBlocked++
      }
    }
    setRetryingMany(false)
    if (stillBlocked > 0)
      toastError({
        title: 'Some movements are still not posted',
        description: `${stillBlocked} of ${ids.length} were refused again; each row still gives its reason.`,
      })
    exitSelection()
    refresh()
  }

  return (
    <div className='flex flex-1 flex-col gap-3 p-3 pb-16'>
      {!list.isPending && rows.length === 0 ? (
        <EmptyState
          icon={CircleAlert}
          title='Nothing has been refused'
          description={emptyDescription}
        />
      ) : (
        <>
          <TreeRowList
            items={rows}
            loading={list.isPending}
            skeletonCount={4}
            className='gap-px'
            getKey={(row: BlockedMovementRow) => row.id}
            renderRow={(row: BlockedMovementRow) => {
              const busy = retry.isPending && retry.variables?.moneyTransactionId === row.id
              const date = row.occurredOn ?? row.occurredAt?.toISOString() ?? null
              const partyRecordId =
                row.partyDefinitionId && row.partyInstanceId
                  ? toRecordId(row.partyDefinitionId, row.partyInstanceId)
                  : null
              const wait = acceptanceWait(row)
              return (
                <OutboxRow
                  id={row.id}
                  icon={<CircleAlert className='size-4 text-destructive' />}
                  date={date ? formatAccountingDate(date, bookTimeZone) : ''}
                  typeLabel={MOVEMENT_PURPOSE_LABEL[row.purpose]}
                  // The refusal, not the purpose: 135 of one dev org's 228 rows
                  // share a purpose, and the reason is what decides what to do
                  // next. `description` keeps it untruncated on the help icon.
                  title={row.reason}
                  description={row.reason}
                  secondary={
                    partyRecordId || wait ? (
                      <span className='flex items-center gap-2'>
                        {partyRecordId && <RecordBadge recordId={partyRecordId} size='sm' />}
                        {wait && <span className='text-muted-foreground text-xs'>{wait}</span>}
                      </span>
                    ) : undefined
                  }
                  amount={formatMinor(row.amountMinor, row.currency)}
                  actions={
                    <TreeRowButton
                      persistent
                      tooltipText='Post this movement again'
                      disabled={busy || retryingMany}
                      onClick={() => retryOne(row.id)}>
                      <RefreshCw className={busy ? 'animate-spin' : undefined} />
                    </TreeRowButton>
                  }
                  onOpen={() => onSelectMovement(row.id)}
                  active={activeMovementId === row.id}
                  selectLabel={`Select ${MOVEMENT_PURPOSE_LABEL[row.purpose]}${row.partyName ? ` - ${row.partyName}` : ''}`}
                />
              )
            }}
          />
          <InfiniteListTail
            hasNextPage={list.hasNextPage}
            isFetchingNextPage={list.isFetchingNextPage}
            fetchNextPage={list.fetchNextPage}
            loadingLabel='Loading more movements...'
          />
        </>
      )}

      <ActionBar
        open={selecting}
        onOpenChange={(open) => !open && exitSelection()}
        duration={Number.POSITIVE_INFINITY}
        position='bottom-center'
        selectedCount={selectedIds.length}
        selectedLabel='selected'
        showClose
        actions={[
          {
            id: 'retry',
            label: 'Post again',
            icon: RefreshCw,
            disabled: retryingMany || retry.isPending,
            onClick: () => void retryMany(selectedIds),
          },
        ]}
      />
    </div>
  )
}
